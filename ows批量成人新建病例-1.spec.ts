import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function sanitizeFilePart(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .trim() || 'run';
}

function getPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数，当前值: ${raw}`);
  }

  return parsed;
}

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

async function getUploadFailureMessage(casePage) {
  if (casePage.isClosed()) {
    return null;
  }

  const categories = [
    {
      prefix: 'X光异常',
      failureKeywords: ['质检失败', '上传失败', '资料分析失败', '请重新上传', '未通过'],
      targets: [
        { label: '全景片', keywords: ['全景片'] },
        { label: '头颅侧位片', keywords: ['头颅侧位片', '侧位片'] },
      ],
    },
    {
      prefix: 'STL模型异常',
      failureKeywords: ['质检失败', '上传失败', '请重新上传', '文件无法正常读取', '内容无效'],
      targets: [
        { label: '上颌STL', keywords: ['上颌', 'upper.stl', 'stl_upper'] },
        { label: '下颌STL', keywords: ['下颌', 'lower.stl', 'stl_lower'] },
      ],
    },
    {
      prefix: '面像及口内像异常',
      failureKeywords: ['质检失败', '上传失败', '资料分析失败', '请重新上传', '未通过'],
      targets: [
        { label: '正面像', keywords: ['正面像', '正面照'] },
        { label: '正面微笑像', keywords: ['正面微笑像', '正面微笑照', '微笑像', '微笑照'] },
        { label: '90°侧面像', keywords: ['90°侧面像', '90度侧面像', '侧面像', '侧面照'] },
        { label: '上牙列像', keywords: ['上牙列像', '上颌颌面像', '上颌面像'] },
        { label: '下牙列像', keywords: ['下牙列像', '下颌颌面像', '下颌面像'] },
        { label: '右侧咬合像', keywords: ['右侧咬合像', '口内右侧咬合像', '右侧位像'] },
        { label: '左侧咬合像', keywords: ['左侧咬合像', '口内左侧咬合像', '左侧位像'] },
        { label: '正面咬合像', keywords: ['正面咬合像', '口内正面咬合像'] },
      ],
    },
  ];

  const failures = await casePage.evaluate(({ categories }) => {
    const normalize = (value) => value.replace(/\s+/g, ' ').trim();
    const elements = Array.from(document.querySelectorAll('body *'));
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const visibleElements = elements.filter(isVisible);
    const result = [];

    for (const category of categories) {
      const failedLabels = new Set();
      const smallNodes = visibleElements
        .map((element) => {
          const text = normalize((element.innerText || element.textContent || '').toString());
          const rect = element.getBoundingClientRect();
          return {
            text,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter((node) => node.text && node.text.length <= 260 && node.width <= 900 && node.height <= 240);

      for (const target of category.targets) {
        const directFailed = smallNodes.some((node) => {
          return target.keywords.some((keyword) => node.text.includes(keyword))
            && category.failureKeywords.some((keyword) => node.text.includes(keyword));
        });
        if (directFailed) {
          failedLabels.add(target.label);
        }
      }

      const targetNodes = [];
      for (let index = 0; index < category.targets.length; index++) {
        const target = category.targets[index];
        for (const node of smallNodes) {
          const hasTarget = target.keywords.some((keyword) => node.text.includes(keyword));
          const hasFailure = category.failureKeywords.some((keyword) => node.text.includes(keyword));
          if (hasTarget && !hasFailure) {
            targetNodes.push({ ...node, label: target.label, targetIndex: index });
          }
        }
      }

      const failureNodes = smallNodes.filter((node) => {
        return category.failureKeywords.some((keyword) => node.text.includes(keyword));
      });

      for (const failure of failureNodes) {
        const nearest = targetNodes
          .map((target) => {
            const dx = Math.abs(failure.centerX - target.centerX);
            const dy = Math.abs(failure.centerY - target.centerY);
            const verticalOverlap = Math.max(0, Math.min(failure.bottom, target.bottom) - Math.max(failure.top, target.top));
            const sameRowBonus = verticalOverlap > 0 ? 120 : 0;
            return { target, dx, dy, score: dy * 4 + dx - sameRowBonus };
          })
          .filter((candidate) => candidate.dy <= 190 && candidate.dx <= 850)
          .sort((a, b) => a.score - b.score)[0];

        if (nearest) {
          failedLabels.add(nearest.target.label);
        }
      }

      for (const label of failedLabels) {
        result.push(`${category.prefix}: ${label}`);
      }
    }

    return Array.from(new Set(result));
  }, { categories });

  return failures.length > 0 ? failures.join('；') : null;
}

test.describe('登录和新建病例完整流程恒牙期 + 成人病例 @adult-batch', () => {
  test.describe.configure({ timeout: 0 });

  test('完整流程：登录 → 新建病例 ', async ({ page }) => {
    console.log('🚀 开始执行完整测试流程...');

    const loginUsername = process.env.OWS_USERNAME || '18217282311';
    const loginPassword = process.env.OWS_PASSWORD || '123456';
    const accountLabel = sanitizeFilePart(process.env.OWS_ACCOUNT_LABEL || loginUsername);
    const shardTotal = getPositiveIntegerEnv('CASE_SHARD_TOTAL', 1);
    const shardIndexRaw = process.env.CASE_SHARD_INDEX;
    const shardIndex = shardIndexRaw === undefined || shardIndexRaw === '' ? 0 : Number(shardIndexRaw);

    if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardTotal) {
      throw new Error(`CASE_SHARD_INDEX 必须是 0 到 ${shardTotal - 1} 之间的整数，当前值: ${shardIndexRaw ?? '未设置'}`);
    }

    const runTag = `${accountLabel}-shard${shardIndex + 1}of${shardTotal}`;
    
    // ========== 自动扫描病例文件夹 ==========
    console.log('\n🔍 自动扫描病例文件夹...');
    
    // 基础路径 - 修改为儿牙病例路径
    const basePath = 'C:/Users/11487/Desktop/IOCS/病例资料类型汇总/新建文件夹/20260511002/新病例';
    
    // 自动获取所有子文件夹
    function getAllSubFolders(dirPath) {
      try {
        const items = fs.readdirSync(dirPath);
        const folders = [];
        
        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          if (fs.statSync(fullPath).isDirectory()) {
            folders.push({
              name: item,
              path: fullPath
            });
          }
        }
        
        return folders;
      } catch (error) {
        console.log(`❌ 读取文件夹失败: ${error.message}`);
        return [];
      }
    }
    
    // 递归查找所有病例文件
    function findCaseFiles(folderPath) {
      const files = {
        stlUpper: null,
        stlLower: null,
        photos: [],
        xrays: []
      };
      
      try {
        const items = fs.readdirSync(folderPath);
        
        for (const item of items) {
          const fullPath = path.join(folderPath, item);
          
          if (fs.statSync(fullPath).isDirectory()) {
            // 如果是文件夹，递归查找
            const subFiles = findCaseFiles(fullPath);
            
            // 合并找到的文件
            if (subFiles.stlUpper) files.stlUpper = subFiles.stlUpper;
            if (subFiles.stlLower) files.stlLower = subFiles.stlLower;
            files.photos.push(...subFiles.photos);
            files.xrays.push(...subFiles.xrays);
            
          } else {
            // 是文件，根据文件名分类
            const fileName = item.toLowerCase();
            const ext = path.extname(item).toLowerCase();
            
            // STL文件 - 匹配两种命名方式
            if (ext === '.stl') {
              // 匹配 stl_upper.stl 或 stl_上颌.stl
              if (fileName.includes('upper') || fileName.includes('上颌')) {
                files.stlUpper = fullPath;
                console.log(`    找到上颌STL: ${item}`);
              }
              // 匹配 stl_lower.stl 或 stl_下颌.stl
              else if (fileName.includes('lower') || fileName.includes('下颌')) {
                files.stlLower = fullPath;
                console.log(`    找到下颌STL: ${item}`);
              }
              // 兼容原来的 stl_u.stl 和 stl_l.stl
              else if (fileName.includes('stl_u') || fileName === 'stl_u.stl') {
                files.stlUpper = fullPath;
                console.log(`    找到上颌STL: ${item}`);
              }
              else if (fileName.includes('stl_l') || fileName === 'stl_l.stl') {
                files.stlLower = fullPath;
                console.log(`    找到下颌STL: ${item}`);
              }
            }
            
            // 图片文件
            else if (['.jpg', '.jpeg', '.png', '.bmp'].includes(ext)) {
              if (fileName.includes('xray') || fileName.includes('射线') || fileName.includes('x光') || fileName.includes('曲面断层') || fileName.includes('头颅侧位')) {
                files.xrays.push(fullPath);
              } else if (fileName.includes('photo') || fileName.includes('照片') || fileName.includes('像') || fileName.includes('正面') || fileName.includes('侧面') || fileName.includes('微笑')) {
                files.photos.push(fullPath);
              }
            }
          }
        }
      } catch (error) {
        console.log(`  读取文件夹出错: ${folderPath}`);
      }
      
      return files;
    }
    
    // 获取所有病例文件夹
    const caseFolders = getAllSubFolders(basePath);
    console.log(`📁 找到 ${caseFolders.length} 个病例文件夹`);
    
    // 为每个文件夹查找病例文件
    const cases = [];
    for (const folder of caseFolders) {
      console.log(`\n扫描文件夹: ${folder.name}`);
      const files = findCaseFiles(folder.path);
      
      console.log(`  找到的文件:`);
      console.log(`    - 上颌STL: ${files.stlUpper ? path.basename(files.stlUpper) : '未找到'}`);
      console.log(`    - 下颌STL: ${files.stlLower ? path.basename(files.stlLower) : '未找到'}`);
      console.log(`    - 照片: ${files.photos.length}张`);
      console.log(`    - X光片: ${files.xrays.length}张`);
      
      // 检查是否找到必要的文件
      const hasStl = files.stlUpper && files.stlLower;
      const hasPhotos = files.photos.length > 0;
      const hasXrays = files.xrays.length > 0;
      
      if (hasStl && hasPhotos && hasXrays) {
        console.log(`  ✅ 找到完整病例资料`);
        
        cases.push({
          name: folder.name,
          path: folder.path,
          stlUpper: files.stlUpper,
          stlLower: files.stlLower,
          photos: files.photos,
          xrays: files.xrays
        });
      } else {
        console.log(`  ❌ 资料不完整`);
      }
    }
    
    console.log(`\n📊 共找到 ${cases.length} 个完整病例资料包`);
    
    if (cases.length === 0) {
      console.log('❌ 没有找到完整病例资料，测试终止');
      return;
    }

    cases.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    const selectedCases = cases.filter((_, index) => index % shardTotal === shardIndex);
    console.log(`\n🎯 当前账号 ${accountLabel} 处理病例分片：${selectedCases.length}/${cases.length}（${shardIndex + 1}/${shardTotal}）`);

    if (selectedCases.length === 0) {
      console.log('⚠️ 当前分片没有分到病例，测试结束。');
      return;
    }

    // ========== 登录流程 ==========
    console.log('\n🔐 登录流程...');
    await page.goto('http://ows.qa.iocs-dental.com/#/login?redirect=/cases&params={}', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    await page.getByRole('textbox', { name: '用户名' }).fill(loginUsername);
    await page.getByRole('textbox', { name: '密码' }).fill(loginPassword);
    
    const checkbox = page.locator('.el-checkbox__inner');
    if (await checkbox.isVisible({ timeout: 3000 })) {
      await checkbox.click();
    }
    
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(/cases/, { timeout: 20000 });
    console.log('✅ 登录成功');

    // ========== 循环处理每个自动发现的病例 ==========
    for (let caseIndex = 0; caseIndex < selectedCases.length; caseIndex++) {
      const currentCase = selectedCases[caseIndex];
      
      console.log(`\n========================================`);
      console.log(`📋 开始处理第 ${caseIndex + 1}/${selectedCases.length} 个病例: ${currentCase.name}`);
      console.log(`========================================`);

      // ========== 新建病例 ==========
      console.log('\n📄 新建病例...');
      
      const newCaseButton = page.locator('button:has-text("新建病例")');
      await newCaseButton.waitFor({ state: 'visible', timeout: 15000 });
      
      const newPagePromise = page.context().waitForEvent('page');
      await newCaseButton.click();
      const casePage = await newPagePromise;
      
      await casePage.waitForLoadState('domcontentloaded');
      await casePage.waitForTimeout(3000);

      // ========== 填写基本信息 ==========
      console.log('\n👤 填写基本信息...');
      
      // 选择替牙期（儿牙）
      await casePage.getByText('恒牙期').click();
      await casePage.locator('div').filter({ hasText: /^请选择机构$/ }).nth(5).click();
      
      // 等待机构下拉选项出现
      await casePage.waitForTimeout(500);
      
      // 尝试选择"香香诊所"，如果没有则选择第一个机构
      const clinicOption = casePage.getByRole('option', { name: '香香诊所' });
      if (await clinicOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await clinicOption.click();
        console.log('✅ 已选择机构: 香香诊所');
      } else {
        // 选择第一个机构
        await casePage.getByRole('option').first().click();
        const firstClinic = await casePage.getByRole('option').first().textContent();
        console.log(`✅ 未找到香香诊所，已选择第一个机构: ${firstClinic}`);
      }
      
      await casePage.waitForTimeout(1000);
      
      // 将阿拉伯数字转换为中文数字（支持1-99）
function numberToChinese(num) {
  const chineseNums = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  
  if (num === 0) return '零';
  
  // 1-9
  if (num < 10) {
    return chineseNums[num];
  }
  
  // 10-19
  if (num >= 10 && num < 20) {
    if (num === 10) return '十';
    return '十' + chineseNums[num % 10];
  }
  
  // 20-99
  if (num >= 20 && num < 100) {
    const ten = Math.floor(num / 10);
    const unit = num % 10;
    if (unit === 0) {
      return chineseNums[ten] + '十';
    }
    return chineseNums[ten] + '十' + chineseNums[unit];
  }
  
  // 100及以上直接返回数字
  return num.toString();
}

      const caseNumber = numberToChinese(caseIndex + 1);
      await casePage.getByRole('textbox', { name: '请输入患者姓名' }).fill(`测试-成人${caseNumber}`);
      
      await casePage.locator('label').filter({ hasText: '女' }).click();
      
      await selectRandomBirthDate(casePage, false);
      
      await casePage.getByRole('button', { name: '下一页' }).click();
      await casePage.waitForTimeout(2000);

      // ========== 选择主诉类型 ==========
      console.log('\n❓ 选择主诉...');
      
      await casePage.waitForTimeout(8000);
      
      // 截图当前页面
      await casePage.screenshot({ path: `case-${runTag}-${caseIndex + 1}-before-health-questions.png` });
      
      // 回答问题
      let questionsAnswered = 0;
      const maxAttempts = 3;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`\n=== 第 ${attempt} 次尝试 ===`);
        
        try {
          // 查找所有"是"选项
          const yesElements = await casePage.locator('text="是"').all();
          console.log(`找到 ${yesElements.length} 个"是"选项`);
          
          // 查找所有"否"选项
          const noElements = await casePage.locator('text="否"').all();
          console.log(`找到 ${noElements.length} 个"否"选项`);
          
          if (yesElements.length >= 2 && noElements.length >= 1) {
            // 点击前两个"是"选项
            for (let i = 0; i < 2; i++) {
              const yesElement = yesElements[i];
              if (await yesElement.isVisible()) {
                await yesElement.scrollIntoViewIfNeeded();
                await yesElement.click({ force: true });
                console.log(`✅ 点击第 ${i + 1} 个"是"选项`);
                questionsAnswered++;
                await casePage.waitForTimeout(1000);
              }
            }
            
            // 点击一个"否"选项
            const noIndex = Math.min(2, noElements.length - 1);
            const noElement = noElements[noIndex];
            if (await noElement.isVisible()) {
              await noElement.scrollIntoViewIfNeeded();
              await noElement.click({ force: true });
              console.log(`✅ 点击第 ${noIndex + 1} 个"否"选项`);
              questionsAnswered++;
              await casePage.waitForTimeout(1000);
            }
            
            console.log(`✅ 已回答 ${questionsAnswered} 个问题`);
            
            if (questionsAnswered >= 3) {
              console.log('✅ 健康问题回答完成！');
              break;
            }
          } else {
            console.log('未找到足够选项，等待后重试...');
            await casePage.waitForTimeout(2000);
          }
          
        } catch (error) {
          console.log(`第 ${attempt} 次尝试失败: ${error.message}`);
          
          if (attempt < maxAttempts) {
            console.log('等待2秒后重试...');
            await casePage.waitForTimeout(2000);
          }
        }
      }
      
      // 专门选择"上牙列中线是否偏斜"
      console.log('\n🦷 选择上牙列中线是否偏斜...');
      
      try {
        // 查找包含"上牙列中线"的元素
        const midlineElements = await casePage.locator('text=上牙列中线').all();
        
        if (midlineElements.length > 0) {
          console.log('找到"上牙列中线"选项');
          
          // 尝试查找旁边的"否"选项
          const noOption = casePage.locator('text=上牙列中线').locator('xpath=following::span[text()="否"]').first();
          if (await noOption.isVisible({ timeout: 3000 })) {
            await noOption.scrollIntoViewIfNeeded();
            await noOption.click({ force: true });
            console.log('✅ 选择"上牙列中线偏斜：否"');
          } else {
            // 尝试找radio选项
            const radioOptions = await casePage.locator('text=上牙列中线').locator('xpath=following::label').all();
            if (radioOptions.length > 0) {
              // 通常第一个是"是"，第二个是"否"，选择第二个
              if (radioOptions.length >= 2) {
                await radioOptions[1].click({ force: true });
                console.log('✅ 选择第二个选项（否）');
              } else {
                await radioOptions[0].click({ force: true });
                console.log('✅ 选择第一个选项');
              }
            }
          }
        } else {
          console.log('⚠️ 未找到"上牙列中线"选项，可能在之前已经选择过了');
        }
      } catch (error) {
        console.log(`⚠️ 选择上牙列中线时出错: ${error.message}`);
      }
      
      await casePage.waitForTimeout(1000);
      
      if (questionsAnswered < 3) {
        console.log('⚠️ 使用坐标法回答问题...');
        const viewport = casePage.viewportSize();
        if (viewport) {
          const centerX = viewport.width / 2;
          const startY = viewport.height * 0.4;
          const spacing = 70;
          
          for (let i = 0; i < 3; i++) {
            const y = startY + (i * spacing);
            const x = i < 2 ? centerX - 100 : centerX + 100;
            
            await casePage.mouse.click(x, y);
            console.log(`✅ 点击位置 (${x}, ${y}) - 第 ${i + 1} 个问题`);
            await casePage.waitForTimeout(1000);
          }
          
          console.log('✅ 主诉类型完成（坐标法）！');
        }
      }
      
      await casePage.waitForTimeout(2000);
      await casePage.screenshot({ path: `case-${runTag}-${caseIndex + 1}-after-health-questions.png` });
      console.log('✅ 主诉选择全部完成');

      // ========== 上传当前病例的所有文件 ==========
      console.log('\n📎 开始上传病例文件...');
      await casePage.waitForTimeout(3000);

      // 1. 上传上颌STL
      console.log('🦷 上传上颌STL文件...');
      const upperStlInput = casePage.locator("xpath=//div[text()='上颌']/following::input[@type='file'][1]");
      await upperStlInput.setInputFiles(currentCase.stlUpper);
      console.log(`✅ 上颌STL上传完成: ${path.basename(currentCase.stlUpper)}`);
      await casePage.waitForTimeout(2000);

      // 2. 上传下颌STL
      console.log('🦷 上传下颌STL文件...');
      const lowerStlInput = casePage.locator("xpath=//div[text()='下颌']/following::input[@type='file'][1]");
      await lowerStlInput.setInputFiles(currentCase.stlLower);
      console.log(`✅ 下颌STL上传完成: ${path.basename(currentCase.stlLower)}`);
      await casePage.waitForTimeout(2000);

      // 3. 上传所有照片
      console.log('📸 上传照片文件...');
      const photoInput = casePage.locator('input[type="file"]').last();
      
      for (let i = 0; i < currentCase.photos.length; i++) {
        const photo = currentCase.photos[i];
        await photoInput.setInputFiles(photo);
        console.log(`  ✅ 照片 ${i+1}/${currentCase.photos.length}: ${path.basename(photo)}`);
        await casePage.waitForTimeout(1500);
      }

      // 4. 上传所有X光片
      console.log('🩻 上传X光片...');
      
      for (let i = 0; i < currentCase.xrays.length; i++) {
        const xray = currentCase.xrays[i];
        await photoInput.setInputFiles(xray);
        console.log(`  ✅ X光片 ${i+1}/${currentCase.xrays.length}: ${path.basename(xray)}`);
        await casePage.waitForTimeout(1500);
      }

      console.log(`✅ 病例 ${caseIndex + 1} 所有文件上传完成！`);
      console.log(`   - STL: 2个文件`);
      console.log(`   - 照片: ${currentCase.photos.length}个文件`);
      console.log(`   - X光: ${currentCase.xrays.length}个文件`);
      
      await casePage.screenshot({ path: `case-${runTag}-${caseIndex + 1}-${sanitizeFilePart(currentCase.name)}-after-upload.png` });
      
      // ========== 智能识别与提交 ==========
      console.log('\n🤖 智能识别与提交...');

      // 点击智能识别
      const aiButton = casePage.locator('button:has-text("智能识别与分类")');
      if (await aiButton.isVisible({ timeout: 5000 })) {
        await aiButton.click();
        console.log('🧠 智能识别开始...');
        
        // 等待识别完成
        console.log('⏳ 等待4分钟让系统处理识别结果...');
        await casePage.waitForTimeout(240000);

        const uploadFailureMessage = await getUploadFailureMessage(casePage);
        if (uploadFailureMessage) {
          console.log(`\n[质检异常] 病例 ${caseIndex + 1} ${currentCase.name}: ${uploadFailureMessage}`);
          console.log('[质检异常] 当前失败页面保持打开，不提交，继续新建下一个病例。');
          await page.bringToFront();
          await page.waitForTimeout(3000);
          continue;
        }
        
        // 第一次点击提交按钮
        console.log('📤 第一次点击提交按钮...');
        const firstSubmit = casePage.locator('button:has-text("提交")').first();
        await firstSubmit.click({ force: true });
        console.log('✅ 已点击第一次提交');
        
        // ========== 步骤1：处理低质量图片弹窗 ==========
        console.log('\n⚠️ 检查是否有低质量图片提示弹窗...');
        await casePage.waitForTimeout(3000);
        
        const stillSubmitBtn = casePage.locator('//span[text()=" 仍要提交 "]');
        if (await stillSubmitBtn.isVisible({ timeout: 5000 })) {
          console.log('⚠️ 检测到低质量图片提示弹窗，点击"仍要提交"...');
          await stillSubmitBtn.click();
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
              await casePage.getByRole('button', { name: toothNumber }).click();
              console.log(`   ✅ 点击数字: ${toothNumber}`);
              await casePage.waitForTimeout(1500);
              
              // 2. 随机选择状态
              const randomStatus = statusOptions[Math.floor(Math.random() * statusOptions.length)];
              console.log(`   选择状态: ${randomStatus}`);
              
              // 3. 点击状态
              await casePage.getByRole('menuitem', { name: randomStatus }).click();
              console.log(`   ✅ 点击状态: ${randomStatus}`);
              await casePage.waitForTimeout(1000);
              
            } catch (error) {
              console.log(`   ❌ 处理失败: ${error.message}`);
            }
          }
        } else {
          console.log('没有待确认牙号');
        }
        
        // ========== 步骤3：最终提交 ==========
        console.log('\n📤 点击提交按钮...');
        const submitButton = casePage.locator('button:has-text("提交")').last();
        await submitButton.waitFor({ state: 'visible', timeout: 5000 });
        await submitButton.click({ force: true });
        console.log('✅ 已点击提交按钮');
        await casePage.waitForTimeout(2000);
        
        // ========== 步骤4：处理二次确认提交弹窗 ==========
        console.log('\n📋 检查二次确认提交弹窗...');
        
        // 方式1：通过文本查找确认按钮
        const confirmSubmitBtn = casePage.locator('button:has-text("确认提交")');
        if (await confirmSubmitBtn.isVisible({ timeout: 3000 })) {
          console.log('📋 检测到二次确认弹窗，点击"确认提交"...');
          await confirmSubmitBtn.click();
          console.log('✅ 已点击"确认提交"按钮');
          await casePage.waitForTimeout(2000);
        } else {
          // 方式2：查找"确认"按钮
          const confirmBtn = casePage.locator('button:has-text("确认")');
          if (await confirmBtn.isVisible({ timeout: 2000 })) {
            console.log('📋 检测到二次确认弹窗，点击"确认"...');
            await confirmBtn.click();
            console.log('✅ 已点击"确认"按钮');
            await casePage.waitForTimeout(2000);
          } else {
            // 方式3：查找"确定"按钮
            const okBtn = casePage.locator('button:has-text("确定")');
            if (await okBtn.isVisible({ timeout: 2000 })) {
              console.log('📋 检测到二次确认弹窗，点击"确定"...');
              await okBtn.click();
              console.log('✅ 已点击"确定"按钮');
              await casePage.waitForTimeout(2000);
            } else {
              console.log('✅ 没有二次确认弹窗');
            }
          }
        }
        
        console.log('✅ 病例提交完成，所有弹窗已处理');
      }
      
      // ========== 等待处理完成 ==========
      console.log('⏳ 等待3分钟让病例处理完成...');
      await casePage.waitForTimeout(180000);
      console.log('✅ 3分钟等待完成');
      
      // 关闭当前病例页面，返回列表准备下一个
      await casePage.close();
      console.log('📄 已关闭病例页面，返回列表');
      
      // 等待一下再处理下一个病例
      await page.waitForTimeout(3000);
    }

    console.log('\n========================================');
    console.log(`🎉 所有 ${selectedCases.length} 个自动发现的成人病例处理完成！`);
    console.log('========================================\n');
    
  });
});
