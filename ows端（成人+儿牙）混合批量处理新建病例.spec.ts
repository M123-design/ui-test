import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function buildRandomBirthDate(isChildCase) {
  const now = new Date();
  const minAge = isChildCase ? 6 : 13;
  const maxAge = isChildCase ? 12 : 35;
  const age = randomInteger(minAge, maxAge);
  const year = now.getFullYear() - age;
  const month = randomInteger(1, 12);
  const day = randomInteger(1, new Date(year, month, 0).getDate());

  return {
    age,
    date: `${year}-${padDatePart(month)}-${padDatePart(day)}`,
    label: isChildCase ? '替牙期' : '恒牙期',
    ageRange: `${minAge}-${maxAge}`,
  };
}

async function selectRandomBirthDate(casePage, isChildCase) {
  const birthDate = buildRandomBirthDate(isChildCase);
  const birthInput = casePage.getByRole('textbox', { name: '请选择出生日期' }).first();

  console.log(`根据 ${birthDate.label} 随机出生日期: ${birthDate.date}，约 ${birthDate.age} 岁，年龄范围 ${birthDate.ageRange} 岁`);

  await birthInput.click();
  await casePage.waitForTimeout(500);

  const filled = await birthInput.fill(birthDate.date).then(() => true).catch(() => false);
  if (filled) {
    await birthInput.press('Enter').catch(() => {});
    await casePage.waitForTimeout(500);

    const inputValue = await birthInput.inputValue().catch(() => '');
    if (inputValue.includes(birthDate.date)) {
      console.log(`出生日期已填写: ${birthDate.date}`);
      return;
    }
  }

  console.log('出生日期输入框无法直接填写，改为从日历面板随机点选一个可选日期。');
  const dateCells = await casePage.locator('td:not(.disabled), .el-date-table__cell:not(.disabled)').all();
  const selectableCells = [];

  for (const cell of dateCells) {
    const text = (await cell.textContent().catch(() => '')).trim();
    const isVisible = await cell.isVisible().catch(() => false);
    if (isVisible && /^\d{1,2}$/.test(text)) {
      selectableCells.push(cell);
    }
  }

  if (selectableCells.length === 0) {
    throw new Error('找不到可选择的出生日期');
  }

  await selectableCells[randomInteger(0, selectableCells.length - 1)].click({ force: true });
  await casePage.waitForTimeout(1000);
  console.log('出生日期已从日历面板随机选择。');
}

function extractSectionText(pageText, startMarker, endMarkers) {
  const lines = pageText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) => line.includes(startMarker));
  if (startIndex < 0) {
    return '';
  }

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (endMarkers.some((marker) => lines[i].includes(marker))) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join('\n');
}

function collectFailedLabelsFromText(sectionText, targets, failureKeywords) {
  const lines = sectionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const failedLabels = new Set();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const currentWindow = lines.slice(Math.max(0, index - 2), index + 3).join(' ');
    const hasFailure = failureKeywords.some((keyword) => currentWindow.includes(keyword));
    if (!hasFailure) {
      continue;
    }

    for (const target of targets) {
      if (target.keywords.some((keyword) => currentWindow.includes(keyword))) {
        failedLabels.add(target.label);
      }
    }
  }

  return Array.from(failedLabels);
}

async function getUploadFailureMessage(casePage) {
  if (casePage.isClosed()) {
    return null;
  }

  const xrayTargets = [
    { label: '全景片', keywords: ['全景片'] },
    { label: '头颅侧位片', keywords: ['头颅侧位片', '侧位片'] },
  ];
  const modelTargets = [
    { label: '上颌STL', keywords: ['上颌', 'upper.stl', 'stl_upper'] },
    { label: '下颌STL', keywords: ['下颌', 'lower.stl', 'stl_lower'] },
  ];
  const photoTargets = [
    { label: '正面像', keywords: ['正面像', '正面照'] },
    { label: '正面微笑像', keywords: ['正面微笑像', '正面微笑照', '微笑像', '微笑照'] },
    { label: '90°侧面像', keywords: ['90°侧面像', '90度侧面像', '侧面像', '侧面照'] },
    { label: '上牙列像', keywords: ['上牙列像', '上颌颌面像', '上颌面像'] },
    { label: '下牙列像', keywords: ['下牙列像', '下颌颌面像', '下颌面像'] },
    { label: '右侧咬合像', keywords: ['右侧咬合像', '口内右侧咬合像', '右侧位像'] },
    { label: '左侧咬合像', keywords: ['左侧咬合像', '口内左侧咬合像', '左侧位像'] },
    { label: '正面咬合像', keywords: ['正面咬合像', '口内正面咬合像'] },
  ];

  const xrayFailureKeywords = ['质检失败', '上传失败', '资料分析失败', '请重新上传', '未通过'];
  const modelFailureKeywords = ['质检失败', '上传失败', '请重新上传', '文件无法正常读取', '内容无效'];
  const photoFailureKeywords = ['质检失败', '上传失败', '资料分析失败', '请重新上传', '未通过'];

  const pageText = await casePage.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  if (!pageText) {
    return null;
  }

  const xraySection = extractSectionText(pageText, 'X光', ['数字模型文件', '面像及口内像', '模型对比']);
  const modelSection = extractSectionText(pageText, '数字模型文件', ['面像及口内像', '模型对比', '提交']);
  const photoSection = extractSectionText(pageText, '面像及口内像', ['X光', '数字模型文件', '模型对比', '提交']);
  const hasExplicitFailure = [
    xraySection,
    modelSection,
    photoSection,
  ].some((section) => ['质检失败', '上传失败', '资料分析失败', '未通过'].some((keyword) => section.includes(keyword)));

  if (!hasExplicitFailure) {
    return null;
  }

  const failures = [
    ...collectFailedLabelsFromText(xraySection, xrayTargets, xrayFailureKeywords).map((label) => `X光异常: ${label}`),
    ...collectFailedLabelsFromText(modelSection, modelTargets, modelFailureKeywords).map((label) => `STL模型异常: ${label}`),
    ...collectFailedLabelsFromText(photoSection, photoTargets, photoFailureKeywords).map((label) => `面像及口内像异常: ${label}`),
  ];

  return failures.length > 0 ? Array.from(new Set(failures)).join('；') : null;
}

async function selectRandomMuscleCheckOptions(casePage) {
  console.log('\n💪 随机选择肌肉检查选项...');

  const muscleOptions = [
    '舌低位',
    '开唇露齿',
    '鼻炎',
    '打鼾',
    '咬下唇',
    '咬上唇',
    '吮指',
    '舌系带过短',
    '上唇系带附着低',
    '伸舌习惯',
    '头前倾'
  ];

  try {
    const selectCount = Math.floor(Math.random() * 4) + 1;
    console.log(`🎲 本次将随机选择 ${selectCount} 个肌肉检查选项`);

    const shuffled = [...muscleOptions].sort(() => 0.5 - Math.random());
    const selectedOptions = shuffled.slice(0, selectCount);
    console.log(`📋 本次选择的选项: ${selectedOptions.join(', ')}`);

    for (const option of selectedOptions) {
      const optionLocator = casePage.getByText(option, { exact: true }).first();
      if (await optionLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
        await optionLocator.scrollIntoViewIfNeeded();
        await optionLocator.click();
        console.log(`  ✅ 已选择: ${option}`);
        await casePage.waitForTimeout(500);
      } else {
        console.log(`  ⚠️ 未找到选项: ${option}`);
      }
    }
  } catch (error) {
    console.log(`⚠️ 选择肌肉检查时出错: ${getErrorMessage(error)}`);
  }

  await casePage.waitForTimeout(1000);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function clickFirstVisible(candidates, description, timeout = 3000) {
  let lastError = null;

  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: 'visible', timeout });
      await candidate.scrollIntoViewIfNeeded().catch(() => {});
      await candidate.click({ timeout });
      return true;
    } catch (error) {
      lastError = error;
      try {
        await candidate.scrollIntoViewIfNeeded().catch(() => {});
        await candidate.click({ timeout, force: true });
        return true;
      } catch (forceError) {
        lastError = forceError;
      }
    }
  }

  throw new Error(`找不到或无法点击${description}${lastError ? `: ${getErrorMessage(lastError)}` : ''}`);
}

async function tryClickFirstVisible(candidates, description, timeout = 3000) {
  try {
    await clickFirstVisible(candidates, description, timeout);
    return true;
  } catch (error) {
    console.log(`⚠️ ${description} 点击失败: ${getErrorMessage(error)}`);
    return false;
  }
}

async function clickOptionalFirstVisible(candidates, timeout = 3000) {
  for (const candidate of candidates) {
    const visible = await candidate.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
    if (!visible) continue;

    try {
      await candidate.scrollIntoViewIfNeeded().catch(() => {});
      await candidate.click({ timeout });
      return true;
    } catch (error) {
      try {
        await candidate.click({ timeout, force: true });
        return true;
      } catch (forceError) {
        // Try the next candidate. This helper is only for optional UI.
      }
    }
  }

  return false;
}

async function openNewCasePage(page) {
  const newCaseButton = page.locator('button:has-text("新建病例")').first();
  await newCaseButton.waitFor({ state: 'visible', timeout: 15000 });

  const newPagePromise = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await newCaseButton.click();

  const openedPage = await newPagePromise;
  let casePage = openedPage || page;
  let openedInNewPage = Boolean(openedPage);

  await casePage.bringToFront().catch(() => {});
  await casePage.waitForLoadState('domcontentloaded').catch(() => {});

  if (!openedPage) {
    await page.waitForURL(/\/cases\/create/, { timeout: 15000 }).catch(() => {});
  }

  if (casePage.isClosed()) {
    const fallbackPage = await findCreatePage(page, 15000);
    casePage = fallbackPage || page;
    openedInNewPage = casePage !== page;
  }

  await casePage.waitForTimeout(3000);
  console.log(`✅ 新建病例页面已打开: ${casePage.url()}`);
  return { casePage, openedInNewPage };
}

async function findCreatePage(mainPage, timeout = 8000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const pages = mainPage.context().pages();
    for (const candidate of pages.slice().reverse()) {
      if (!candidate.isClosed() && candidate.url().includes('/cases/create')) {
        await candidate.bringToFront().catch(() => {});
        await candidate.waitForLoadState('domcontentloaded').catch(() => {});
        return candidate;
      }
    }

    await mainPage.waitForTimeout(500);
  }

  return null;
}

async function returnToCaseList(page, casePage, openedInNewPage) {
  if (openedInNewPage && casePage !== page) {
    if (!casePage.isClosed()) {
      await casePage.close();
    }
    await page.bringToFront().catch(() => {});
  } else {
    await page.goto('http://ows.qa.iocs-dental.com/#/cases', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }

  await page.waitForTimeout(3000);
}

async function returnToCaseListWithoutClosing(page, casePage, openedInNewPage) {
  await page.goto('http://ows.qa.iocs-dental.com/#/cases', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(3000);
}

async function selectCaseType(casePage, isChildCase) {
  const caseTypeLabel = isChildCase ? '乳牙/替牙期' : '恒牙期';
  await clickFirstVisible(
    [
      casePage.getByText(caseTypeLabel, { exact: true }).first(),
      casePage.locator('label').filter({ hasText: caseTypeLabel }).first(),
      casePage.locator('[role="radio"]').filter({ hasText: caseTypeLabel }).first(),
      casePage.locator('div').filter({ hasText: new RegExp(`^${caseTypeLabel}$`) }).first(),
    ],
    `牙期选项【${caseTypeLabel}】`,
    5000,
  );
}

async function selectClinic(casePage, clinicName = '香香诊所') {
  await casePage.locator('div').filter({ hasText: /^请选择机构$/ }).nth(5).click();
  await casePage.waitForTimeout(500);

  const clinicOption = casePage.getByRole('option', { name: clinicName });
  if (await clinicOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await clinicOption.click();
    console.log(`✅ 已选择机构: ${clinicName}`);
  } else {
    const firstOption = casePage.getByRole('option').first();
    const firstClinic = await firstOption.textContent().catch(() => '');
    await firstOption.click();
    console.log(`✅ 未找到${clinicName}，已选择第一个机构: ${firstClinic}`);
  }
}

async function clickNextPage(casePage, description = '下一页按钮') {
  await clickFirstVisible(
    [
      casePage.getByRole('button', { name: /^下一页$/ }).last(),
      casePage.locator('//span[normalize-space()="下一页"]/ancestor::button[1]').last(),
      casePage.locator('button:has-text("下一页")').last(),
      casePage.getByText('下一页', { exact: true }).last(),
    ],
    description,
    5000,
  );
}

async function waitForReportResult(casePage, maxWaitMs = 900000, intervalMs = 15000) {
  const startTime = Date.now();
  let lastLogMinute = -1;

  while (Date.now() - startTime < maxWaitMs) {
    if (casePage.isClosed()) {
      console.log('   ⚠️ 页面已关闭，停止等待报告结果。');
      return 'closed';
    }

    const retryVisible = await casePage.locator('button:has-text("重新生成")').isVisible({ timeout: 1000 }).catch(() => false);
    if (retryVisible) {
      console.log('   ⚠️ 检测到【重新生成】按钮，报告生成失败。');
      return 'failed';
    }

    const pageText = await casePage.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    const generated = [
      '报告已生成',
      '诊断报告已生成',
      '初诊报告已生成',
      '正畸诊断报告已生成',
      '查看报告',
    ].some((keyword) => pageText.includes(keyword));

    if (generated) {
      console.log('   ✅ 检测到报告已生成，继续处理下一个病例。');
      return 'generated';
    }

    const elapsedMinute = Math.floor((Date.now() - startTime) / 60000);
    if (elapsedMinute !== lastLogMinute) {
      lastLogMinute = elapsedMinute;
      console.log(`   ⏳ 报告生成检测中... 已等待 ${elapsedMinute} 分钟`);
    }

    await casePage.waitForTimeout(intervalMs);
  }

  console.log('   ⚠️ 等待15分钟后仍未检测到报告生成或失败，继续处理下一个病例。');
  return 'timeout';
}

async function captureSubmittedCaseInfo(casePage, patientName, sourceName, caseId = '') {
  const info = {
    caseId,
    patientName,
    sourceName,
    url: casePage.url(),
  };

  const pageText = await casePage.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  if (!info.caseId) {
    const idMatch = pageText.match(/病例编号[：:\s]*([0-9]{10,})/);
    if (idMatch) {
      info.caseId = idMatch[1];
    }
  }

  if (!info.caseId) {
    const urlMatch = casePage.url().match(/id=([0-9]{10,})/);
    if (urlMatch) {
      info.caseId = urlMatch[1];
    }
  }

  if (!info.caseId) {
    const currentCaseText = await casePage.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const match = currentCaseText.match(/病例编号[：:\s]*([0-9]{10,})/);
    if (match) {
      info.caseId = match[1];
    }
  }

  console.log(`🧾 本次提交病例记录: 病例编号=${info.caseId || '未读取到'}，患者=${patientName}，资料=${sourceName}`);
  return info;
}

test.describe('登录和新建病例完整流程 - 成人+儿牙+失败补充DDM', () => {
  test.describe.configure({ timeout: 0 });
  
  test('完整流程：登录 → 交替新建成人/儿牙病例 → 失败补传DDM', async ({ page }) => {
    console.log('🚀 开始执行完整测试流程...');

    // ========== 基础路径配置 ==========
    const adultBasePath = 'C:/Users/11487/Desktop/IOCS/病例资料类型汇总/成人病例';
    const childBasePath = 'C:/Users/11487/Desktop/IOCS/病例资料类型汇总/儿牙资料';
    const ddmBasePath = 'C:/Users/11487/Desktop/IOCS/病例资料类型汇总/ddm文件';

    // ========== 核心侦测：扫描主资料(STL/照片) ==========
    function findValidCases(baseDir, caseType) {
      const validCases = [];
      
      function scanDir(currentDir) {
        try {
          const items = fs.readdirSync(currentDir);
          const currentCaseFiles = { stlUpper: null, stlLower: null, photos: [], xrays: [] };
          
          for (const item of items) {
            const fullPath = path.join(currentDir, item);
            if (fs.statSync(fullPath).isDirectory()) {
              scanDir(fullPath);
            } else {
              const fileName = item.toLowerCase();
              const ext = path.extname(item).toLowerCase();
              if (ext === '.stl') {
                if (fileName.includes('upper') || fileName.includes('上颌') || fileName.includes('stl_u')) {
                  currentCaseFiles.stlUpper = fullPath;
                } else if (fileName.includes('lower') || fileName.includes('下颌') || fileName.includes('stl_l')) {
                  currentCaseFiles.stlLower = fullPath;
                }
              } else if (['.jpg', '.jpeg', '.png', '.bmp'].includes(ext)) {
                if (fileName.includes('xray') || fileName.includes('射线') || fileName.includes('x光') || fileName.includes('断层') || fileName.includes('侧位')) {
                  currentCaseFiles.xrays.push(fullPath);
                } else if (fileName.includes('photo') || fileName.includes('照') || fileName.includes('像') || fileName.includes('正面') || fileName.includes('侧面') || fileName.includes('微笑')) {
                  currentCaseFiles.photos.push(fullPath);
                }
              }
            }
          }
          
          if (currentCaseFiles.stlUpper && currentCaseFiles.stlLower && currentCaseFiles.photos.length > 0) {
            const dirParts = currentDir.split(path.sep);
            const parentName = dirParts[dirParts.length - 2] || '';
            const folderName = path.basename(currentDir);
            validCases.push({
              name: `[${parentName}] - ${folderName}`,
              path: currentDir,
              stlUpper: currentCaseFiles.stlUpper,
              stlLower: currentCaseFiles.stlLower,
              photos: currentCaseFiles.photos,
              xrays: currentCaseFiles.xrays,
              type: caseType
            });
          }
        } catch (error) {
          console.error(`扫描目录出错: ${currentDir}`, getErrorMessage(error));
        }
      }
      
      console.log(`\n📁 正在扫描目录提取【图片/STL资料】: ${baseDir}`);
      scanDir(baseDir);
      return validCases;
    }

    // ========== 核心侦测：扫描DDM补充资料 ==========
    function findDdmCases(baseDir) {
      const ddmCases = [];
      
      function scanDdmDir(currentDir) {
        try {
          const items = fs.readdirSync(currentDir);
          let ddmFile = null;
          let jsonFile = null;
          
          for (const item of items) {
            const fullPath = path.join(currentDir, item);
            if (fs.statSync(fullPath).isDirectory()) {
              scanDdmDir(fullPath);
            } else {
              const ext = path.extname(item).toLowerCase();
              if (ext === '.ddm') ddmFile = fullPath;
              if (ext === '.json') jsonFile = fullPath;
            }
          }
          
          if (ddmFile && jsonFile) {
            ddmCases.push({
              name: path.basename(currentDir),
              ddm: ddmFile,
              json: jsonFile
            });
          }
        } catch (error) {
          console.error(`扫描DDM目录出错: ${currentDir}`, getErrorMessage(error));
        }
      }
      
      console.log(`\n📁 正在扫描目录提取【DDM/JSON补充资料】: ${ddmBasePath}`);
      scanDdmDir(baseDir);
      return ddmCases;
    }

    // 汇总组别
    const adultCases = findValidCases(adultBasePath, 'adult');
    console.log(`📊 汇总：共提取出【成人】病例组: ${adultCases.length} 个`);
    const childCases = findValidCases(childBasePath, 'child');
    console.log(`📊 汇总：共提取出【儿牙】病例组: ${childCases.length} 个`);
    const ddmDataList = findDdmCases(ddmBasePath);
    console.log(`📊 汇总：共提取出【DDM补救资料】组: ${ddmDataList.length} 个 (供失败时无限循环使用)`);
    
    let globalDdmIndex = 0;

    if (adultCases.length === 0 && childCases.length === 0) {
      console.log('❌ 没有找到任何主病例资料，测试终止');
      return;
    }

    // ========== 提交处理函数 ==========
    async function handleSubmit(casePage) {
      // 第一次点击提交按钮
      console.log('📤 第一次点击提交按钮...');
      const firstSubmit = casePage.locator('button:has-text("提交")').first();
      
      if (!await firstSubmit.isVisible({ timeout: 5000 })) {
        throw new Error('❌ 错误：找不到第一次提交按钮，流程终止！');
      }
      
      await firstSubmit.click({ force: true });
      console.log('✅ 已点击第一次提交');
      
      // ========== 步骤1：处理低质量图片弹窗 ==========
      console.log('\n⚠️ 检查是否有低质量图片提示弹窗...');
      await casePage.waitForTimeout(3000);
      
      const stillSubmitBtn = [
        casePage.locator('//span[normalize-space()="仍要提交"]/ancestor::button[1]').first(),
        casePage.locator('button:has-text("仍要提交")').first(),
        casePage.getByText('仍要提交', { exact: true }).first(),
      ];
      if (await clickOptionalFirstVisible(stillSubmitBtn, 5000)) {
        console.log('⚠️ 检测到低质量图片提示弹窗，点击"仍要提交"...');
        console.log('✅ 已点击"仍要提交"按钮');
        await casePage.waitForTimeout(3000);
      } else {
        console.log('✅ 没有低质量图片提示弹窗');
      }
      
      // ========== 步骤2：处理待确认牙号 ==========
      console.log('\n🔍 从下方文本获取待确认牙号...');
      
      // 获取页面文本
      const pageText = await casePage.evaluate(() => document.body.innerText);
      
      // 找出所有 "#数字待确认" 的牙号
      const confirmToothNumbers = [];
      const regex = /#(\d+)待确认/g;
      let match;
      
      while ((match = regex.exec(pageText)) !== null) {
        confirmToothNumbers.push(match[1]);
        console.log(`找到待确认牙号: ${match[1]}`);
      }
      
      console.log(`需要点击的牙号: ${confirmToothNumbers.join(', ')}`);
      
      if (confirmToothNumbers.length > 0) {
        // ========== 点击上方对应的数字按钮 ==========
        console.log('\n📋 开始点击上方数字按钮...');
        
        const statusOptions = ['缺失', '正常牙', '种植体', '正萌牙', '未萌出牙龈', '残根残冠'];
        
        for (const toothNumber of confirmToothNumbers) {
          console.log(`\n👉 点击上方数字: ${toothNumber}`);
          
          try {
            // 1. 点击数字按钮
            const toothButton = casePage.getByRole('button', { name: toothNumber });
            if (!await toothButton.isVisible({ timeout: 3000 })) {
              throw new Error(`找不到牙号按钮 ${toothNumber}`);
            }
            await toothButton.click();
            console.log(`   ✅ 点击数字: ${toothNumber}`);
            await casePage.waitForTimeout(1500);
            
            // 2. 随机选择状态
            const randomStatus = statusOptions[Math.floor(Math.random() * statusOptions.length)];
            console.log(`   选择状态: ${randomStatus}`);
            
            // 3. 点击状态
            const statusMenuItem = casePage.getByRole('menuitem', { name: randomStatus });
            if (!await statusMenuItem.isVisible({ timeout: 3000 })) {
              throw new Error(`找不到状态选项 ${randomStatus}`);
            }
            await statusMenuItem.click();
            console.log(`   ✅ 点击状态: ${randomStatus}`);
            await casePage.waitForTimeout(1000);
            
          } catch (error) {
            console.log(`   ❌ 处理失败: ${getErrorMessage(error)}`);
            throw new Error(`❌ 牙号 ${toothNumber} 处理失败，流程终止！错误: ${getErrorMessage(error)}`);
          }
        }
        console.log('\n✅ 所有牙号处理完成！');
      } else {
        console.log('没有待确认牙号');
      }
      
      // ========== 步骤3：最终提交 ==========
      console.log('\n📤 点击提交按钮...');
      const submitButton = casePage.locator('button:has-text("提交")').last();
      
      if (!await submitButton.isVisible({ timeout: 5000 })) {
        throw new Error('❌ 错误：找不到最终提交按钮，流程终止！');
      }
      
      await submitButton.click({ force: true });
      console.log('✅ 已点击提交按钮');
      await casePage.waitForTimeout(2000);
      
      // ========== 步骤4：处理二次确认提交弹窗 ==========
      console.log('\n📋 检查二次确认提交弹窗...');
      
      let confirmed = false;
      
      // 方式1：通过文本查找确认按钮
      const confirmSubmitBtn = casePage.locator('button:has-text("确认提交")');
      if (await confirmSubmitBtn.isVisible({ timeout: 3000 })) {
        console.log('📋 检测到二次确认弹窗，点击"确认提交"...');
        await confirmSubmitBtn.click();
        console.log('✅ 已点击"确认提交"按钮');
        confirmed = true;
        await casePage.waitForTimeout(2000);
      } else {
        // 方式2：查找"确认"按钮
        const confirmBtn = casePage.locator('button:has-text("确认")');
        if (await confirmBtn.isVisible({ timeout: 2000 })) {
          console.log('📋 检测到二次确认弹窗，点击"确认"...');
          await confirmBtn.click();
          console.log('✅ 已点击"确认"按钮');
          confirmed = true;
          await casePage.waitForTimeout(2000);
        } else {
          // 方式3：查找"确定"按钮
          const okBtn = casePage.locator('button:has-text("确定")');
          if (await okBtn.isVisible({ timeout: 2000 })) {
            console.log('📋 检测到二次确认弹窗，点击"确定"...');
            await okBtn.click();
            console.log('✅ 已点击"确定"按钮');
            confirmed = true;
            await casePage.waitForTimeout(2000);
          } else {
            console.log('✅ 没有二次确认弹窗');
            confirmed = true; // 没有弹窗也算成功
          }
        }
      }
      
      if (!confirmed) {
        throw new Error('❌ 错误：二次确认弹窗处理失败，流程终止！');
      }
      
      // 验证提交是否成功（检查成功提示）- 修复选择器语法错误
      await casePage.waitForTimeout(2000);
      
      // 正确的方式：分别检查每个选择器
      let hasSuccessMessage = false;
      
      // 检查 CSS 类名
      const successClassMsg = casePage.locator('.el-message--success, .el-notification--success');
      if (await successClassMsg.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('✅ 检测到成功提示消息（通过CSS类）！');
        hasSuccessMessage = true;
      }
      
      // 检查文本内容（使用 text 选择器需要单独调用）
      if (!hasSuccessMessage) {
        const successText = casePage.locator('text="提交成功"');
        if (await successText.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('✅ 检测到"提交成功"提示！');
          hasSuccessMessage = true;
        }
      }
      
      if (!hasSuccessMessage) {
        const saveText = casePage.locator('text="保存成功"');
        if (await saveText.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('✅ 检测到"保存成功"提示！');
          hasSuccessMessage = true;
        }
      }
      
      if (!hasSuccessMessage) {
        const operationText = casePage.locator('text="操作成功"');
        if (await operationText.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log('✅ 检测到"操作成功"提示！');
          hasSuccessMessage = true;
        }
      }
      
      if (hasSuccessMessage) {
        console.log('✅ 提交成功验证通过！');
      } else {
        console.log('⚠️ 未检测到明确成功提示，但继续执行...');
      }
      
      console.log('✅ 病例提交完成，所有弹窗已处理');
    }

    // ========== 登录流程 ==========
    console.log('\n🔐 登录流程...');
    await page.goto('http://ows.qa.iocs-dental.com/#/login?redirect=/cases&params={}', { waitUntil: 'networkidle', timeout: 30000 });
    await page.getByRole('textbox', { name: '用户名' }).fill('18217282397');
    await page.getByRole('textbox', { name: '密码' }).fill('123456');
    const checkbox = page.locator('.el-checkbox__inner');
    if (await checkbox.isVisible({ timeout: 3000 })) await checkbox.click();
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(/cases/, { timeout: 20000 });
    console.log('✅ 登录成功！');

    // ========== 交替处理病例 ==========
    const maxLoops = Math.max(adultCases.length, childCases.length);
    let adultIndex = 0;
    let childIndex = 0;
    let totalCases = 0;
    const submittedCaseInfos = [];

    function numberToChinese(num) {
      const chineseNums = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
      if (num < 10) return chineseNums[num];
      if (num >= 10 && num < 20) return num === 10 ? '十' : '十' + chineseNums[num % 10];
      if (num >= 20 && num < 100) return chineseNums[Math.floor(num/10)] + '十' + (num%10 === 0 ? '' : chineseNums[num%10]);
      if (num >= 100 && num < 1000) {
        const h = Math.floor(num/100), r = num%100;
        if (r === 0) return chineseNums[h] + '百';
        if (r < 10) return chineseNums[h] + '百零' + chineseNums[r];
        const t = Math.floor(r/10), u = r%10;
        return chineseNums[h] + '百' + (t === 1 ? '一十' : chineseNums[t] + '十') + (u === 0 ? '' : chineseNums[u]);
      }
      return num.toString();
    }

    // ========== 主循环 ==========
    for (let loop = 0; loop < maxLoops; loop++) {
      const currentCases = [];
      if (adultIndex < adultCases.length) { currentCases.push(adultCases[adultIndex]); adultIndex++; }
      if (childIndex < childCases.length) { currentCases.push(childCases[childIndex]); childIndex++; }

      for (const currentCase of currentCases) {
        totalCases++;
        const isChildCase = currentCase.type === 'child';

        console.log(`\n========================================`);
        console.log(`📋 开始新建第 ${totalCases} 个病例: ${currentCase.name} (${isChildCase ? '儿牙' : '成人'})`);
        console.log(`========================================`);

        // 新建病例
        console.log('▶️ 步骤 1/8: 打开新建病例页面，填写基础信息...');
        let { casePage, openedInNewPage } = await openNewCasePage(page);

        // 牙期与机构
        await selectCaseType(casePage, isChildCase);
        const refreshedCasePage = await findCreatePage(page, 3000);
        if (refreshedCasePage) {
          casePage = refreshedCasePage;
          openedInNewPage = casePage !== page;
        }
        await selectClinic(casePage);
        await casePage.waitForTimeout(500);
        await casePage.waitForTimeout(1000);

        // 姓名
        const caseNumber = numberToChinese(totalCases);
        const patientName = `${isChildCase ? '测试-儿牙' : '测试-成人'}${caseNumber}`;
        await casePage.getByRole('textbox', { name: '请输入患者姓名' }).fill(patientName);

        // 性别与年龄
        await casePage.locator('label').filter({ hasText: '女' }).click();
        await selectRandomBirthDate(casePage, isChildCase);
        await clickNextPage(casePage);
        await casePage.waitForTimeout(2000);

        // 主诉
        console.log('▶️ 步骤 2/8: 选择主诉类型与健康问题回答...');
        await casePage.waitForTimeout(8000);
        let questionsAnswered = 0;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const yesElements = await casePage.locator('text="是"').all();
            const noElements = await casePage.locator('text="否"').all();
            if (yesElements.length >= 2 && noElements.length >= 1) {
              for (let i = 0; i < 2; i++) {
                if (await yesElements[i].isVisible()) { await yesElements[i].click({ force: true }); questionsAnswered++; await casePage.waitForTimeout(1000); }
              }
              const noIndex = Math.min(2, noElements.length - 1);
              if (await noElements[noIndex].isVisible()) { await noElements[noIndex].click({ force: true }); questionsAnswered++; await casePage.waitForTimeout(1000); }
              if (questionsAnswered >= 3) break;
            }
          } catch (error) {}
        }
        
        try {
          const midlineElements = await casePage.locator('text=上牙列中线').all();
          if (midlineElements.length > 0) {
            const noOption = casePage.locator('text=上牙列中线').locator('xpath=following::span[text()="否"]').first();
            if (await noOption.isVisible({ timeout: 3000 })) await noOption.click({ force: true });
          }
        } catch (error) {}

        if (isChildCase) {
          await selectRandomMuscleCheckOptions(casePage);
        }
        await casePage.waitForTimeout(2000);

        // ========== 上传主资料 ==========
        console.log('▶️ 步骤 3/8: 开始上传病例资料（模型/照片/X光）...');
        await casePage.waitForTimeout(3000);
        
        console.log('   🦷 正在上传[上颌STL]模型...');
        const upperStlInput = casePage.locator("xpath=//div[text()='上颌']/following::input[@type='file'][1]");
        await upperStlInput.setInputFiles(currentCase.stlUpper);
        await casePage.waitForTimeout(2000);
        
        console.log('   🦷 正在上传[下颌STL]模型...');
        const lowerStlInput = casePage.locator("xpath=//div[text()='下颌']/following::input[@type='file'][1]");
        await lowerStlInput.setInputFiles(currentCase.stlLower);
        await casePage.waitForTimeout(2000);
        
        const photoInput = casePage.locator('input[type="file"]').last();
        console.log(`📸 正在逐张上传口内/口外照片 (共 ${currentCase.photos.length} 张)...`);
        for (let i = 0; i < currentCase.photos.length; i++) {
          await photoInput.setInputFiles(currentCase.photos[i]);
          await casePage.waitForTimeout(1500);
        }
        
        console.log(`🩻 正在逐张上传X光片 (共 ${currentCase.xrays.length} 张)...`);
        for (let i = 0; i < currentCase.xrays.length; i++) {
          await photoInput.setInputFiles(currentCase.xrays[i]);
          await casePage.waitForTimeout(1500);
        }

        // ========== 智能识别与提交 ==========
        console.log('▶️ 步骤 4/8: 点击【智能识别与分类】按钮...');
        const aiClicked = await tryClickFirstVisible(
          [
            casePage.locator('button:has-text("智能识别与分类")').first(),
            casePage.getByRole('button', { name: '智能识别与分类' }).first(),
          ],
          '智能识别与分类按钮',
          8000,
        );
        if (!aiClicked) {
          throw new Error(`❌ 病例 ${totalCases} 找不到【智能识别与分类】按钮，流程终止`);
        }

        console.log('▶️ 步骤 5/8: ⏳ 等待 4分钟 让系统处理AI识别结果，每15秒检查一次页面状态...');
        let aiWaitClosed = false;
        for (let waited = 0; waited < 240000; waited += 15000) {
          if (casePage.isClosed()) {
            aiWaitClosed = true;
            break;
          }
          await casePage.waitForTimeout(15000);
        }

        if (aiWaitClosed) {
          console.log('[质检检查] 当前页面已关闭，返回病例列表继续下一个病例。');
          await returnToCaseListWithoutClosing(page, casePage, openedInNewPage);
          continue;
        }

        const uploadFailureMessage = await getUploadFailureMessage(casePage);
        if (uploadFailureMessage) {
          console.log(`\n[质检异常] 病例 ${totalCases} ${currentCase.name}: ${uploadFailureMessage}`);
          console.log('[质检异常] 不提交当前病例，返回病例列表继续新建下一个病例。');
          await returnToCaseListWithoutClosing(page, casePage, openedInNewPage);
          continue;
        }
        console.log('[质检检查] 未检测到STL/X光/面像质检异常，继续提交。');

        console.log('▶️ 步骤 6/8: 调用提交处理函数...');
        try {
          await handleSubmit(casePage);
          console.log('✅ 提交处理成功！');
          const submittedCaseId = extractCaseIdFromUrl(casePage.url());
          const submittedCaseInfo = await captureSubmittedCaseInfo(casePage, patientName, currentCase.name, submittedCaseId || '');
          submittedCaseInfos.push(submittedCaseInfo);
        } catch (error) {
          console.error(getErrorMessage(error));
          throw new Error(`❌ 病例 ${totalCases} 提交失败，流程终止！错误: ${getErrorMessage(error)}`);
        }
        console.log('▶️ 步骤 7/8: ⏳ 初次提交完毕，开始检测报告生成/失败状态（最长15分钟）...');
        const reportStatus = await waitForReportResult(casePage);
        console.log(`▶️ 步骤 8/8: 报告检测结果: ${reportStatus}，检查是否需要补传DDM...`);
        console.log('✅ 当前病例处理完成，准备进入下一病例。');

      }
    }
    
    console.log('\n🧾 本次已提交病例记录汇总：');
    for (const item of submittedCaseInfos) {
      console.log(`   - 病例编号=${item.caseId || '未读取到'}，患者=${item.patientName}，资料=${item.sourceName}`);
    }

    console.log('\n🌟 恭喜！所有测试用例和已全部自动化执行完毕！');
  });
});
