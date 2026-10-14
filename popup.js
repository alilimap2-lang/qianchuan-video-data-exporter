const start = document.querySelector('#start');
const status = document.querySelector('#status');
const applyDate = document.querySelector('#applyDate');
const startDate = document.querySelector('#startDate');
const endDate = document.querySelector('#endDate');
const clearFilters = document.querySelector('#clearFilters');
const diagnostics = document.querySelector('#diagnostics');
const stop = document.querySelector('#stop');
const datePanel = document.querySelector('.date-panel');
const mode = document.querySelector('#mode');
const materialScope = document.querySelector('#materialScope');

function setRunning(value) {
  start.disabled = value;
  stop.hidden = !value;
}

async function refreshDiagnosticsButton() {
  const saved = await chrome.storage.local.get('qianchuanLastDiagnostics');
  diagnostics.hidden = !saved.qianchuanLastDiagnostics;
}

refreshDiagnosticsButton();
setRunning(false);

applyDate.addEventListener('change', () => {
  startDate.disabled = !applyDate.checked;
  endDate.disabled = !applyDate.checked;
  datePanel.classList.toggle('disabled', !applyDate.checked);
});

datePanel.classList.add('disabled');

function localIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shifted(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = shifted(today, -1);
  let from = today;
  let to = today;
  const range = button.dataset.range;
  if (range === 'yesterday') from = to = yesterday;
  else if (/^\d+$/.test(range)) {
    // 与千川口径一致：最近 N 天截至昨天。例如 20 日选“最近15天”为 5 日～19 日。
    to = yesterday;
    from = shifted(to, -(Number(range) - 1));
  } else if (range === 'lastWeek') {
    const mondayOffset = (today.getDay() + 6) % 7;
    to = shifted(today, -mondayOffset - 1);
    from = shifted(to, -6);
  } else if (range === 'thisMonth') {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    to = today;
  }
  applyDate.checked = true;
  applyDate.dispatchEvent(new Event('change'));
  startDate.value = localIso(from);
  endDate.value = localIso(to);
}));

chrome.tabs.query({active: true, currentWindow: true}).then(async ([tab]) => {
  if (!tab?.url?.startsWith('https://qianchuan.jinritemai.com/')) {
    await chrome.storage.local.set({qianchuanRunning: false});
    setRunning(false);
    return;
  }
  try {
    const state = await sendToPage(tab.id, {type: 'QIANCHUAN_GET_STATE'});
    const actuallyRunning = Boolean(state?.running);
    await chrome.storage.local.set({qianchuanRunning: actuallyRunning});
    setRunning(actuallyRunning);
    setStatus(actuallyRunning
      ? '当前页面的抓取任务正在运行…'
      : state?.pageReady
        ? '已识别千川“素材 → 视频”页面，可以开始抓取。'
        : '已连接千川页面，请确认进入“素材 → 视频”。');

    const settings = await sendToPage(tab.id, {type: 'QIANCHUAN_GET_SETTINGS'});
    if (settings?.startDate) startDate.value = settings.startDate;
    if (settings?.endDate) endDate.value = settings.endDate;
  } catch (_) {
    await chrome.storage.local.set({qianchuanRunning: false});
    setRunning(false);
    setStatus('已连接千川页面；请点击开始，扩展将重新检测当前素材表。');
  }
});

function setStatus(message, error = false) {
  status.textContent = message;
  status.style.color = error ? '#b91c1c' : '#4b5563';
}

async function sendToPage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error?.message || '')) throw error;
    await chrome.scripting.executeScript({target: {tabId}, files: ['content.js']});
    await new Promise(resolve => setTimeout(resolve, 250));
    return chrome.tabs.sendMessage(tabId, message);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'QIANCHUAN_PROGRESS') return;
  setStatus(message.message, Boolean(message.error));
  if (message.done || message.error) setRunning(false);
  if (message.done) refreshDiagnosticsButton();
});

diagnostics.addEventListener('click', async () => {
  const saved = await chrome.storage.local.get('qianchuanLastDiagnostics');
  if (!saved.qianchuanLastDiagnostics) return;
  const blob = new Blob(['\uFEFF' + saved.qianchuanLastDiagnostics], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `千川导出诊断_${new Date().toISOString().slice(0,10)}.txt`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

start.addEventListener('click', async () => {
  setRunning(true);
  setStatus('正在连接当前千川页面…');
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.url?.startsWith('https://qianchuan.jinritemai.com/')) {
    setStatus('当前标签页不是千川页面，请先打开千川投放管理。', true);
    setRunning(false);
    return;
  }
  try {
    const response = await sendToPage(tab.id, {
      type: 'QIANCHUAN_START',
      options: {
        mode: mode.value,
        materialScope: materialScope.value,
        applyDateRange: applyDate.checked,
        startDate: startDate.value,
        endDate: endDate.value,
        clearFilters: clearFilters.checked
      }
    });
    if (!response?.accepted) throw new Error('页面脚本未响应，请刷新千川页面后重试。');
    setStatus('任务已开始，可保持此窗口打开查看进度。');
  } catch (error) {
    setStatus(error.message, true);
    setRunning(false);
  }
});

stop.addEventListener('click', async () => {
  stop.disabled = true;
  setStatus('正在停止读取并整理诊断报告…');
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  try {
    await sendToPage(tab.id, {type: 'QIANCHUAN_STOP'});
  } catch (error) {
    setStatus(`停止请求未送达：${error.message}`, true);
    setRunning(false);
  } finally {
    stop.disabled = false;
  }
});
