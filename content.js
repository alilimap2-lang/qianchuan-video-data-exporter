(() => {
  if (window.__qianchuanVideoExporterLoaded) return;
  window.__qianchuanVideoExporterLoaded = true;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();
  let activeRoot = document;
  let activeDateRoot = document;
  let activeTableContainer = null;
  let activePaginationRoot = null;
  const visible = (el) => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const textEquals = (text) => [...document.querySelectorAll('button,a,span,div,th')]
    .filter(el => visible(el) && clean(el.textContent) === text);

  const textEqualsWithin = (root, text) => [...root.querySelectorAll('button,a,span,div,th')]
    .filter(el => visible(el) && clean(el.textContent) === text);

  function findProductDetailRoot() {
    const markers = [...document.querySelectorAll('span,div')]
      .filter(el => visible(el) && clean(el.textContent) === '当前周期：');
    const roots = [];
    for (const marker of markers) {
      let current = marker;
      for (let depth = 0; current && depth < 18; depth++, current = current.parentElement) {
        const text = clean(current.innerText);
        if (text.includes('添加视频') && text.includes('创建时间') && current.querySelectorAll('table').length >= 2) {
          roots.push(current);
          break;
        }
      }
    }
    return roots.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.width * ar.height - br.width * br.height;
    })[0] || null;
  }

  function findChengfangDetailRoot() {
    const headerTable = [...document.querySelectorAll('table')].find(table => {
      const text = clean(table.innerText);
      return visible(table) && text.includes('创建时间') && /共\s*\d+\s*个视频/.test(text);
    });
    if (!headerTable) return null;
    let current = headerTable;
    for (let depth = 0; current && depth < 12; depth++, current = current.parentElement) {
      const hasSearch = current.querySelector('input[placeholder*="输入视频名称/ID"]');
      if (current.querySelectorAll('table').length >= 2 && hasSearch) return current;
    }
    return headerTable.parentElement;
  }

  function findPaginationRoot(container) {
    let current = container;
    for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
      const hasNumericPage = [...current.querySelectorAll('li,button,[role="button"]')]
        .some(el => visible(el) && /^\d+$/.test(clean(el.textContent)));
      if (hasNumericPage || /共\s*\d+\s*条记录/.test(clean(current.innerText))) return current;
    }
    return container;
  }

  function configureDataScope(mode) {
    activeRoot = mode === 'product'
      ? (findProductDetailRoot() || document)
      : mode === 'chengfang'
        ? (findChengfangDetailRoot() || document)
        : document;
    activeDateRoot = mode === 'chengfang' ? document : activeRoot;
    const headerTable = [...activeRoot.querySelectorAll('table')]
      .find(table => visible(table) && clean(table.innerText).includes('创建时间') && clean(table.innerText).includes('视频'));
    activeTableContainer = headerTable?.closest('[class*="table__container"]') || headerTable?.parentElement?.parentElement || null;
    activePaginationRoot = activeTableContainer ? findPaginationRoot(activeTableContainer) : null;
    if (mode === 'product' && (!findProductDetailRoot() || !activeTableContainer)) {
      throw new Error('未定位到右侧挂车视频详情，请先在左侧计划中点击“素材”打开右侧详情。');
    }
    if (mode === 'chengfang' && (!findChengfangDetailRoot() || !activeTableContainer)) {
      throw new Error('未定位到乘方右侧视频抽屉，请先打开乘方计划的素材详情。');
    }
  }

  function progress(message, extra = {}) {
    chrome.runtime.sendMessage({type: 'QIANCHUAN_PROGRESS', message, ...extra}).catch(() => {});
  }

  function clickElement(el) {
    if (!el) return false;
    el.scrollIntoView({block: 'center', inline: 'center'});
    el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
    el.click();
    return true;
  }

  function fireRealisticClick(el) {
    if (!el) return false;
    el.scrollIntoView({block: 'center', inline: 'center'});
    const options = {bubbles: true, cancelable: true, view: window};
    el.dispatchEvent(new PointerEvent('pointerdown', options));
    el.dispatchEvent(new MouseEvent('mousedown', options));
    el.dispatchEvent(new PointerEvent('pointerup', options));
    el.dispatchEvent(new MouseEvent('mouseup', options));
    el.dispatchEvent(new MouseEvent('click', options));
    return true;
  }

  function clickableAncestor(el) {
    let current = el;
    for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
      const role = current.getAttribute?.('role');
      const cursor = getComputedStyle(current).cursor;
      if (/^(BUTTON|A)$/.test(current.tagName) || role === 'button' || typeof current.onclick === 'function' || cursor === 'pointer') return current;
    }
    return el;
  }

  async function closePopups() {
    const clicked = new Set();
    for (const modal of document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="drawer"], [class*="Drawer"]')) {
      if (!visible(modal)) continue;
      const modalText = clean(modal.innerText);
      // 挂车视频的数据本身位于右侧详情抽屉，不能把它当作普通弹窗关闭。
      const containsVideoSearch = modal.querySelector('input[placeholder*="输入视频名称/ID"]');
      if ((modalText.includes('当前周期：') || containsVideoSearch) && modalText.includes('创建时间')) continue;
      const close = [...modal.querySelectorAll('button,[role="button"],[aria-label],[title]')].find(el => {
        const label = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
        return /^(关闭|关 闭|×|x)$/i.test(label) || /关闭/.test(label);
      });
      if (close) {
        clickElement(close);
        clicked.add(close);
      }
    }
    // 千川部分推荐浮层不是标准 modal/drawer，只是普通定位元素；继续扫描可见“×/关闭”。
    const rootRect = activeRoot !== document ? activeRoot.getBoundingClientRect() : null;
    const globalCloses = [...document.querySelectorAll('button,[role="button"],[aria-label],[title],span,i')]
      .filter(visible)
      .filter(el => {
        const label = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
        return /^(×|x|关闭|关 闭)$/i.test(label) || /^(close|modal-close|dialog-close)$/i.test(label);
      })
      .map(clickableAncestor)
      .filter((el, index, list) => list.indexOf(el) === index && !clicked.has(el));
    for (const close of globalCloses) {
      const boxText = clean((close.closest('[class*="tag"],[class*="Tag"],[class*="filter"],[class*="Filter"]') || {}).innerText);
      if (/投放状态[:：]/.test(boxText)) continue;
      const rect = close.getBoundingClientRect();
      // 保护挂车视频右侧详情抽屉自身左上角的蓝色关闭按钮。
      if (rootRect && rect.top < rootRect.top + 80 && rect.left > rootRect.left - 80 && rect.left < rootRect.left + 40) continue;
      clickElement(close);
      await sleep(120);
    }
    await sleep(300);
  }

  async function ensureVideoTab(mode) {
    await closePopups();
    if (mode === 'chengfang') {
      configureDataScope(mode);
      if (!activeTableContainer) throw new Error('未找到乘方视频数据表。');
      return true;
    }
    if (mode === 'product') activeRoot = findProductDetailRoot() || document;
    const material = textEqualsWithin(activeRoot, '素材').find(el => el.closest('button,[role="tab"],a') || el.parentElement);
    if (material) {
      clickElement(material.closest('button,[role="tab"],a') || material);
      await sleep(900);
    }
    const video = textEqualsWithin(activeRoot, '视频').find(el => el.closest('button,[role="tab"],a') || el.parentElement);
    if (video) {
      clickElement(video.closest('button,[role="tab"],a') || video);
      await sleep(1200);
    }
    configureDataScope(mode);
    if (!activeTableContainer) throw new Error('未找到视频数据表，请确认已进入“素材 → 视频”。');
    const materialSelected = textEqualsWithin(activeRoot, '素材').some(el => {
      const tab = el.closest('.ovui-tabs__tab,[role="tab"]');
      return tab && (/active|selected/.test(String(tab.className)) || tab.getAttribute('aria-selected') === 'true');
    });
    const videoSelected = textEqualsWithin(activeRoot, '视频').some(el => {
      const option = el.closest('.ovui-radio-item,[role="radio"],button');
      return option && (/checked|active|selected/.test(String(option.className)) || option.getAttribute('aria-checked') === 'true');
    });
    if (!materialSelected || !videoSelected) {
      throw new Error(`选项校验失败：素材=${materialSelected ? '已选中' : '未选中'}，视频=${videoSelected ? '已选中' : '未选中'}。`);
    }
    return true;
  }

  async function ensurePromotionMode(mode) {
    if (mode === 'chengfang') {
      if (!findChengfangDetailRoot()) throw new Error('请先在乘方页面打开计划的右侧素材抽屉。');
      return;
    }
    if (mode === 'product' && findProductDetailRoot()) return;
    const targetText = mode === 'product' ? '推商品' : '推直播间';
    const target = textEquals(targetText).find(el => el.closest('button,[role="tab"],a') || el.parentElement);
    if (!target) throw new Error(`未找到“${targetText}”入口，请确认位于全域投放页面。`);
    const clickable = target.closest('button,[role="tab"],a') || target;
    const selected = clickable.getAttribute('aria-selected') === 'true'
      || /active|selected/.test(String(clickable.className));
    if (!selected) {
      clickElement(clickable);
      await sleep(1400);
    }
  }

  async function clearFilters() {
    const moreFilterButton = () => [...activeRoot.querySelectorAll('button')]
      .find(el => visible(el) && /^更多筛选\s*\d*$/.test(clean(el.textContent)));
    // activeRoot 在三种模式中分别指向：引流直播间页面、挂车右侧抽屉、乘方右侧抽屉。
    // 因此只会点击当前拉取区域内的真实“清空”按钮，不会误清其他计划或左侧列表。
    const clearButton = () => [...activeRoot.querySelectorAll('button')]
      .find(el => visible(el) && clean(el.textContent) === '清空');
    const activeFilterCount = () => {
      const text = clean(moreFilterButton()?.textContent || '');
      return Number(text.match(/(\d+)$/)?.[1] || 0);
    };

    const before = activeFilterCount();
    if (!before && !clearButton()) return true;

    // 实测千川会由真实 button“清空”一次性移除所有条件；不要点击标签本体，
    // 否则会展开“投放状态/视频类型”的下拉菜单并导致流程卡住。
    for (let attempt = 0; attempt < 3; attempt++) {
      const button = clearButton();
      if (!button) return activeFilterCount() === 0;
      button.scrollIntoView({block: 'center', inline: 'center'});
      button.click();

      for (let wait = 0; wait < 24; wait++) {
        await sleep(250);
        if (!clearButton() && activeFilterCount() === 0) {
          await sleep(700);
          return true;
        }
      }
    }
    return !clearButton() && activeFilterCount() === 0;
  }

  function currentReportDateRange() {
    const start = activeDateRoot.querySelector('input[placeholder="请选择开始日期"],input[placeholder="开始日期"]');
    const end = activeDateRoot.querySelector('input[placeholder="请选择结束日期"],input[placeholder="结束日期"]');
    if (!start || !end) throw new Error('未找到页面顶部的统计日期选择器。');
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(start.value) || !/^20\d{2}-\d{2}-\d{2}$/.test(end.value)) {
      throw new Error(`日期值无效：${start.value || '空'} 至 ${end.value || '空'}。`);
    }
    return {start: start.value, end: end.value};
  }

  function setNativeInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
  }

  async function applyReportDateRange(startValue, endValue) {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(startValue) || !/^20\d{2}-\d{2}-\d{2}$/.test(endValue)) {
      throw new Error('请在扩展中选择有效的开始日期和结束日期。');
    }
    if (startValue > endValue) throw new Error('开始日期不能晚于结束日期。');
    const start = activeDateRoot.querySelector('input[placeholder="请选择开始日期"],input[placeholder="开始日期"]');
    const end = activeDateRoot.querySelector('input[placeholder="请选择结束日期"],input[placeholder="结束日期"]');
    if (!start || !end) throw new Error('未找到页面顶部的统计日期选择器。');
    setNativeInputValue(start, startValue);
    setNativeInputValue(end, endValue);
    end.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}));
    end.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', bubbles: true}));
    end.blur();
    await sleep(1600);
    const actual = currentReportDateRange();
    if (actual.start !== startValue || actual.end !== endValue) {
      throw new Error(`页面日期未完全应用：当前为 ${actual.start} 至 ${actual.end}。`);
    }
    return actual;
  }

  async function nudgeHorizontalScrollbar() {
    const candidates = [...activeRoot.querySelectorAll('div')]
      .filter(el => visible(el) && el.querySelector('table') && el.scrollWidth > el.clientWidth + 80)
      .sort((a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth));
    const scroller = candidates[0];
    if (!scroller) return;
    const before = scroller.scrollLeft;
    const target = Math.min(Math.max(before + 36, 36), scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollLeft = target;
    scroller.dispatchEvent(new Event('scroll', {bubbles: true}));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await sleep(600);
  }

  function dataTables() {
    const root = activeTableContainer || activeRoot;
    return [...root.querySelectorAll('table')].filter(table => visible(table));
  }

  function findHeaderTable() {
    return dataTables().find(table => clean(table.textContent).includes('创建时间'));
  }

  function headerNames() {
    const table = findHeaderTable();
    if (!table) return [];
    const headerRow = [...table.querySelectorAll('tr')].find(tr => clean(tr.textContent).includes('创建时间'));
    if (!headerRow) return [];
    return [...headerRow.querySelectorAll(':scope > th')].map((th, index) => clean(th.textContent) || `__忽略列${index}`);
  }

  function parseDate(text) {
    const match = clean(text).match(/(20\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return null;
    const [, y, m, d, hh, mm, ss] = match;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }

  function readRows() {
    const tables = dataTables();
    const headers = headerNames();
    const creationIndex = headers.findIndex(header => header === '创建时间');
    const rows = [];
    for (const table of tables) {
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.querySelectorAll(':scope > td')].map(td => clean(td.innerText));
        const dateIndex = creationIndex >= 0 && creationIndex < cells.length
          ? creationIndex
          : cells.findIndex(cell => parseDate(cell));
        const date = dateIndex >= 0 ? parseDate(cells[dateIndex]) : null;
        if (date) rows.push({cells, dateIndex, date});
      }
    }
    return rows;
  }

  function readSummaryRecord(dateRange) {
    const summary = {};
    for (const table of dataTables()) {
      const headerRow = [...table.querySelectorAll('tr')].find(tr => clean(tr.textContent).includes('创建时间'))
        || table.querySelector('thead tr');
      if (!headerRow) continue;
      const headers = [...headerRow.querySelectorAll(':scope > th')]
        .map((th, index) => clean(th.textContent) || `__忽略列${index}`);
      const candidates = [...table.querySelectorAll('tr')];
      const row = candidates.find(tr => /共\s*\d+\s*个视频/.test(clean(tr.innerText)))
        || candidates.find(tr => {
          const text = clean(tr.innerText);
          return text && !text.includes('创建时间') && !parseDate(text);
        });
      if (!row) continue;
      const cells = [...row.querySelectorAll(':scope > th, :scope > td')].map(cell => clean(cell.innerText).replace(/\s+/g, ' '));
      if (!cells.length) continue;
      // 千川汇总行会省略复选框、创建时间等前置单元格，不能从左侧按索引硬对齐。
      // 汇总指标位于表格右侧，因此从右向左映射，保证末尾指标（尤其净成交金额/ROI）准确落列。
      for (let offset = 1; offset <= Math.min(headers.length, cells.length); offset++) {
        const header = headers[headers.length - offset];
        const value = cells[cells.length - offset] ?? '';
        if (header && !header.startsWith('__') && value) summary[header] = value;
      }
    }
    const rangeText = dateRange?.start && dateRange?.end
      ? `${dateRange.start} 至 ${dateRange.end}`
      : '当前统计日期范围';
    summary['视频'] = `汇总（${rangeText}）`;
    summary['创建时间'] = rangeText;
    summary.__summary = true;
    return summary;
  }

  function pageSize() {
    const text = clean((activePaginationRoot || activeRoot).innerText);
    const match = text.match(/(\d+)\s*条\s*\/\s*页/) || text.match(/(\d+)条\/页/);
    return Number(match?.[1]) || 10;
  }

  function totalRows() {
    const text = clean((activePaginationRoot || activeRoot).innerText);
    const match = text.match(/共\s*(\d+)\s*条记录/) || text.match(/共\s*(\d+)\s*个视频/);
    return Number(match?.[1]) || 0;
  }

  async function waitForFullPageRows() {
    const expected = Math.min(pageSize(), totalRows() || pageSize());
    let best = [];
    let stable = 0;
    let previousSignature = '';
    for (let attempt = 0; attempt < 24; attempt++) {
      const current = readRows();
      if (current.length > best.length) best = current;
      const signature = current.map(row => `${row.date?.getTime()}|${row.cells.join('|')}`).join('\n');
      stable = signature === previousSignature ? stable + 1 : 0;
      previousSignature = signature;
      if (current.length >= expected && stable >= 2) return current;
      await sleep(400);
    }
    return best;
  }

  async function ensureDescending() {
    let rows = await waitForFullPageRows();
    const isDescending = values => values.every((row, index) => index === 0 || values[index - 1].date >= row.date);
    if (rows.length >= 2 && isDescending(rows)) return true;
    const header = textEqualsWithin(activeTableContainer || activeRoot, '创建时间')[0];
    if (!header) throw new Error('找不到“创建时间”列。');
    for (let attempt = 0; attempt < 4; attempt++) {
      clickElement(header.closest('th') || header);
      await sleep(1400);
      rows = await waitForFullPageRows();
      if (rows.length < 2 || isDescending(rows)) return true;
    }
    throw new Error('无法确认创建时间为降序，请手动点击“创建时间”到最新在上。');
  }

  function normalizeRow(row, headers) {
    let cells = row.cells.slice();
    const result = {};
    const alignedHeaders = headers.length === cells.length ? headers : cells.map((_, i) => headers[i] || `字段${i + 1}`);
    alignedHeaders.forEach((header, i) => { result[header || `字段${i + 1}`] = cells[i] ?? ''; });
    const videoKey = Object.keys(result).find(key => key === '视频') || Object.keys(result).find(key => !key.startsWith('__'));
    const videoText = result[videoKey] || '';
    const idMatch = videoText.match(/素材ID[:：]\s*(\d+)/);
    if (idMatch) result['素材ID'] = idMatch[1];
    // 保留千川表格中显示的完整时间格式，例如 2026-09-19 10:48:58。
    // 不使用 toLocaleString，避免月份、日期丢失前导零或因地区设置改变格式。
    const sourceCreationTime = row.dateIndex >= 0 ? clean(row.cells[row.dateIndex]).replace(/\s+/g, ' ') : '';
    result['创建时间'] = sourceCreationTime || result['创建时间'];
    return result;
  }

  function activePage() {
    const root = activePaginationRoot || activeRoot;
    const active = [...root.querySelectorAll('li,[class*="pagination"] button')].find(el => visible(el) && /active|selected|current/.test(el.className + ' ' + el.getAttribute('aria-current')));
    return Number(clean(active?.textContent)) || 1;
  }

  function nextButton() {
    const root = activePaginationRoot || activeRoot;
    const candidates = [...root.querySelectorAll('li,button,[role="button"]')].filter(visible);
    return candidates.find(el => {
      const label = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
      const cls = String(el.className);
      return (/下一页|next/i.test(label) || /pagination.*next|next.*pagination|page.*next|next.*page/i.test(cls)) &&
        !el.disabled && !/disabled/.test(cls) && el.getAttribute('aria-disabled') !== 'true';
    });
  }

  function pageNumberButton(pageNumber) {
    const value = String(pageNumber);
    const root = activePaginationRoot || activeRoot;
    const matches = [...root.querySelectorAll('li,button,[role="button"],a,span,div')]
      .filter(el => visible(el) && clean(el.textContent) === value)
      .map(clickableAncestor)
      .filter((el, index, list) => list.indexOf(el) === index)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });
    return matches.find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width <= 80 && rect.height <= 80;
    });
  }

  async function goToPage(pageNumber, previousFirstDate) {
    const numeric = pageNumberButton(pageNumber);
    const button = numeric || nextButton();
    if (!button) return false;
    fireRealisticClick(button);
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const rows = readRows();
      const first = rows[0]?.date?.getTime();
      if (rows.length && (!previousFirstDate || first !== previousFirstDate)) return true;
    }
    return false;
  }

  async function goNext(previousFirstDate) {
    const button = nextButton();
    if (!button) return false;
    clickElement(button);
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const first = readRows()[0]?.date?.getTime();
      if (first && first !== previousFirstDate) return true;
    }
    return false;
  }

  function csvEscape(value) {
    const text = String(value ?? '').replace(/\r?\n/g, ' / ');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadCsv(records, dateRange, summaryRecord, mode, sourceColumns, materialScope) {
    const exportRows = summaryRecord ? [summaryRecord, ...records] : records;
    // 完全采用本次运行时千川右侧表格的实际表头及顺序，不预设任何指标。
    // 素材ID是内部去重辅助字段；若千川没有把它设为独立列，则不额外插列。
    const columns = sourceColumns
      .filter(column => column && !column.startsWith('__'))
      .filter((column, index, list) => list.indexOf(column) === index);
    const csv = '\uFEFF' + [columns, ...exportRows.map(row => columns.map(col => row[col] ?? ''))]
      .map(row => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const range = dateRange?.start && dateRange?.end ? `${dateRange.start}_至_${dateRange.end}` : '当前日期范围';
    const typeName = mode === 'product' ? '挂车视频' : mode === 'chengfang' ? '乘方视频' : '引流直播间';
    const scopeName = materialScope === 'all' ? '全部素材' : '新发布素材';
    anchor.download = `千川${typeName}${scopeName}数据_${range}.csv`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 3000);
  }

  function diagnosticsText(report) {
    const text = [
      '千川视频数据导出诊断报告',
      `生成时间：${new Date().toLocaleString('zh-CN', {hour12: false})}`,
      `统计日期：${report.dateRange?.start || '未知'} 至 ${report.dateRange?.end || '未知'}`,
      `素材范围：${report.materialScope === 'all' ? '所选统计日期的全部素材' : '日期内新发布素材'}`,
      `成功导出：${report.recordCount} 条`,
      `扫描页数：${report.pages.length}`,
      '',
      '逐页结果：',
      ...report.pages.map(page => `第 ${page.page} 页：识别 ${page.rows} 行，新增 ${page.added} 条，最早 ${page.oldest || '未知'}，最晚 ${page.newest || '未知'}`),
      '',
      `问题清单（${report.issues.length}）：`,
      ...(report.issues.length ? report.issues.map((issue, i) => `${i + 1}. [${issue.stage}] ${issue.message}`) : ['无'])
    ].join('\r\n');
    return text;
  }

  async function run(options = {}) {
    const materialScope = options.materialScope === 'all' ? 'all' : 'published';
    const report = {issues: [], pages: [], dateRange: null, materialScope, recordCount: 0};
    const issue = (stage, error) => report.issues.push({stage, message: error?.message || String(error)});
    const attempt = async (stage, fn) => {
      try { return await fn(); }
      catch (error) { issue(stage, error); return null; }
    };

    const mode = ['product', 'chengfang'].includes(options.mode) ? options.mode : 'live';
    const modeName = mode === 'product' ? '挂车视频' : mode === 'chengfang' ? '乘方视频' : '引流直播间';
    progress(`正在进入${modeName}数据…`);
    await attempt('选择拉取类型', () => ensurePromotionMode(mode));
    progress('正在关闭弹窗并进入视频素材…');
    const correctTabs = await attempt('进入视频素材', () => ensureVideoTab(mode));
    if (!correctTabs) throw new Error('未能确认右侧“素材 → 视频”处于选中状态，已停止以避免导出错误数据。');
    if (options.applyDateRange) {
      progress('正在应用指定日期范围…');
      report.dateRange = await attempt('应用日期范围', () => applyReportDateRange(options.startDate, options.endDate));
    } else {
      progress('正在沿用千川当前日期范围…');
      report.dateRange = await attempt('读取当前日期范围', currentReportDateRange);
    }
    if (options.clearFilters) {
      progress('正在清空当前素材筛选…');
      const cleared = await attempt('清空筛选', clearFilters);
      if (cleared === false) issue('清空筛选', '操作后筛选标签仍存在，已继续运行。');
    } else {
      progress('沿用千川当前素材筛选设置…');
    }
    progress('正在移动横向滚轴并校准表格列…');
    await attempt('校准横向滚轴', nudgeHorizontalScrollbar);
    progress('正在按创建时间降序排列…');
    const globallySorted = Boolean(await attempt('创建时间降序', ensureDescending));
    if (!globallySorted) issue('创建时间降序', '未能确认全表按创建时间降序，将扫描全部分页后再按日期筛选，不提前按日期边界停止。');
    progress('正在读取所选统计日期范围的汇总数据…');
    const summaryRecord = await attempt('读取汇总数据', () => readSummaryRecord(report.dateRange));

    const cutoff = report.dateRange?.start
      ? new Date(`${report.dateRange.start}T00:00:00`)
      : new Date();
    if (!report.dateRange?.start) {
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - 6);
    }
    const rangeEnd = report.dateRange?.end
      ? new Date(`${report.dateRange.end}T23:59:59`)
      : new Date(8640000000000000);
    const headers = headerNames();
    const records = [];
    const seen = new Set();

    const firstPage = pageNumberButton(1);
    if (firstPage && activePage() !== 1) {
      await attempt('返回第1页', () => goToPage(1, readRows()[0]?.date?.getTime()));
    }

    for (let page = 1; page <= 100; page++) {
      if (abortRequested) {
        issue('用户停止', `在读取第 ${page} 页前收到停止请求。`);
        break;
      }
      await attempt(`第${page}页关闭弹窗`, closePopups);
      await attempt(`第${page}页校准滚轴`, nudgeHorizontalScrollbar);
      let rows = await attempt(`第${page}页读取`, waitForFullPageRows) || [];
      if (!rows.length) {
        issue(`第${page}页读取`, '没有识别到数据行；已再次等待后重试。');
        await sleep(1500);
        rows = readRows();
      }
      if (!rows.length) {
        issue(`第${page}页读取`, '重试后仍无数据行，无法继续翻页。');
        break;
      }
      progress(`正在读取第 ${activePage() || page} 页，已找到 ${records.length} 条范围内数据…`);
      const beforeCount = records.length;
      for (const row of rows) {
        if (materialScope === 'published' && (row.date < cutoff || row.date > rangeEnd)) continue;
        const record = normalizeRow(row, headers);
        const key = record['素材ID'] || `${record['视频']}|${record['创建时间']}`;
        if (!seen.has(key)) { seen.add(key); records.push(record); }
      }
      report.pages.push({
        page: activePage() || page,
        rows: rows.length,
        added: records.length - beforeCount,
        newest: rows[0]?.date?.toLocaleString('zh-CN', {hour12: false}) || '',
        oldest: rows.at(-1)?.date?.toLocaleString('zh-CN', {hour12: false}) || ''
      });
      const pageIsDescending = rows.every((row, index) => index === 0 || rows[index - 1].date >= row.date);
      const pageOldest = rows.reduce((min, row) => row.date < min ? row.date : min, rows[0].date);
      const pageNewest = rows.reduce((max, row) => row.date > max ? row.date : max, rows[0].date);
      if (materialScope === 'published' && globallySorted && pageNewest < cutoff) {
        issue('日期边界', `第 ${page} 页最新创建时间 ${pageNewest.toLocaleString('zh-CN', {hour12: false})} 已早于近七天，自动停止。`);
        break;
      }
      if (materialScope === 'published' && globallySorted && pageIsDescending && pageOldest < cutoff) {
        issue('日期边界', `第 ${page} 页已跨过近七天边界，完成本页有效数据后自动停止。`);
        break;
      }
      if (abortRequested) {
        issue('用户停止', `读取第 ${page} 页后收到停止请求。`);
        break;
      }
      const firstDate = rows[0].date?.getTime();
      const moved = await attempt(`第${page}页翻页`, () => goToPage(page + 1, firstDate));
      if (!moved) {
        issue(`第${page}页翻页`, '未找到可用的下一页，或翻页后数据未变化。');
        break;
      }
    }

    records.sort((a, b) => String(b['创建时间']).localeCompare(String(a['创建时间'])));
    report.recordCount = records.length;
    if (records.length) {
      downloadCsv(records, report.dateRange, summaryRecord, mode, headers, materialScope);
    } else {
      const emptyRecord = Object.fromEntries(headers.map(header => [header, '']));
      const messageColumn = headers.includes('视频') ? '视频' : headers[0];
      if (messageColumn) emptyRecord[messageColumn] = '未抓取到数据';
      downloadCsv([emptyRecord], report.dateRange, summaryRecord, mode, headers, materialScope);
      issue('导出CSV', materialScope === 'all'
        ? '没有识别到任何视频素材，已生成包含“未抓取到数据”提示的 CSV。'
        : '没有找到指定日期范围内创建的视频，已生成包含“未抓取到数据”提示的 CSV。');
    }
    await chrome.storage.local.set({qianchuanLastDiagnostics: diagnosticsText(report)});
    progress(records.length
      ? `运行完成：导出 ${records.length} 条，扫描 ${report.pages.length} 页，记录 ${report.issues.length} 个问题。可点击“下载上次诊断报告”。`
      : `运行完成：未抓取到数据，已生成提示表格；扫描 ${report.pages.length} 页。可点击“下载上次诊断报告”。`,
    {done: true, count: records.length, issues: report.issues.length});
  }

  let running = false;
  let abortRequested = false;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'QIANCHUAN_GET_STATE') {
      sendResponse({running, pageReady: Boolean(document.querySelector('input[placeholder*="输入视频名称/ID"]'))});
      return;
    }
    if (message?.type === 'QIANCHUAN_GET_SETTINGS') {
      try { sendResponse(currentReportDateRange()); }
      catch (error) { sendResponse({error: error.message}); }
      return;
    }
    if (message?.type === 'QIANCHUAN_STOP') {
      abortRequested = true;
      progress('已收到停止请求，正在保存已抓数据和诊断报告…');
      sendResponse({accepted: true});
      return;
    }
    if (message?.type !== 'QIANCHUAN_START') return;
    if (running) { sendResponse({accepted: false, reason: 'running'}); return; }
    running = true;
    abortRequested = false;
    chrome.storage.local.set({qianchuanRunning: true});
    sendResponse({accepted: true});
    run(message.options || {})
      .catch(error => progress(`失败：${error.message}`, {error: true}))
      .finally(() => {
        running = false;
        abortRequested = false;
        chrome.storage.local.set({qianchuanRunning: false});
      });
    return true;
  });
})();
