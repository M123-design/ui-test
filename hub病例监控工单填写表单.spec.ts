import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('病例监控工单处理完整流程测试-处理最后5个工单', async ({ page }) => {
  test.setTimeout(600000);
  
  const imagesFolderPath = 'C:\\Users\\11487\\Desktop\\IOCS\\病例资料类型汇总\\正常方案\\一个方案的病例\\1936707265418579969';
  
  let imageFiles = [];
  try {
    if (fs.existsSync(imagesFolderPath)) {
      const files = fs.readdirSync(imagesFolderPath);
      imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext);
      });
      console.log(`找到 ${imageFiles.length} 个图片文件`);
    }
  } catch (error) {
    console.log(`读取文件夹失败: ${error.message}`);
  }
  
  // 辅助函数：处理单个工单
  async function processWorkOrder(page, order, index, totalToProcess) {
    // 先获取病例编号
    let caseNumber = '';
    try {
      const targetRow = page.locator(`(//span[text()="查看"])[${order}]`).locator('xpath=ancestor::tr');
      const cells = targetRow.locator('td');
      for (let i = 0; i < await cells.count(); i++) {
        const cellText = await cells.nth(i).textContent();
        if (cellText) {
          const match = cellText.match(/\d{19}/);
          if (match) {
            caseNumber = match[0];
            break;
          }
        }
      }
    } catch (error) {
      console.log('获取病例编号失败');
    }
    
    console.log(`📋 正在处理病例编号: ${caseNumber}`);
    console.log(`点击第 ${order} 个查看按钮...`);
    await page.locator(`(//span[text()="查看"])[${order}]`).click();
    await page.waitForTimeout(5000);
    
    // 填写进展
    console.log('填写上一阶段进展...');
    await page.getByRole('textbox', { name: '请输入上一阶段进展' }).fill('pl测试');
    await page.waitForTimeout(500);
    
    // 上传图片
    console.log('上传图片...');
    const fileInputs = page.locator('input[type="file"]');
    if (await fileInputs.count() > 0 && imageFiles.length > 0) {
      for (let i = 0; i < Math.min(await fileInputs.count(), imageFiles.length); i++) {
        const imagePath = path.join(imagesFolderPath, imageFiles[i]);
        if (fs.existsSync(imagePath)) {
          await fileInputs.nth(i).setInputFiles(imagePath);
          console.log(`✓ 上传图片: ${imageFiles[i]}`);
          await page.waitForTimeout(1000);
        }
      }
    }
    
    // 等待所有单选按钮加载完成
    await page.waitForTimeout(2000);
    
    // 获取页面上所有单选按钮，全部点击一遍
    const allRadios = await page.locator('input[type="radio"]').all();
    console.log(`找到 ${allRadios.length} 个单选按钮，全部点击一遍...`);
    
    for (let i = 0; i < allRadios.length; i++) {
      try {
        await allRadios[i].scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        await allRadios[i].click({ force: true });
        console.log(`  ✓ 已点击第 ${i + 1} 个单选按钮`);
        await page.waitForTimeout(100);
      } catch (error) {
        console.log(`  ✗ 点击第 ${i + 1} 个单选按钮失败`);
      }
    }
    
    // 填写文本字段
    console.log('填写文本字段...');
    const sideInput = page.getByRole('textbox', { name: '请输入侧貌变化' });
    if (await sideInput.count() > 0) await sideInput.fill('测试');
    
    const summaryInput = page.getByRole('textbox', { name: '请输入目标综述' });
    if (await summaryInput.count() > 0) await summaryInput.fill('测试');
    
    const remarkInput = page.getByRole('textbox', { name: '您可以添加阶段报告备注' });
    if (await remarkInput.count() > 0) await remarkInput.fill('11111');
    await page.waitForTimeout(500);
    
    // 保存
    console.log('保存表单...');
    const saveBtn = page.getByRole('button', { name: '暂存' });
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      console.log('✓ 已点击暂存');
      await page.waitForTimeout(3000);
    }
    
    // 关闭弹窗
    const closeButtons = page.getByRole('button', { name: 'close' });
    for (let i = 0; i < await closeButtons.count(); i++) {
      await closeButtons.nth(i).click();
      await page.waitForTimeout(300);
    }
    
    console.log(`✅ 病例编号 ${caseNumber} 处理完成 (${index}/${totalToProcess})`);
    return caseNumber;
  }
  
  try {
    // 1. 登录
    console.log('开始登录...');
    await page.goto('http://orthohub.qa.iocs-dental.com:9080/#/login?redirect=/distribution&params={}');
    await page.getByRole('textbox', { name: '用户名' }).fill('13062825597');
    await page.getByRole('textbox', { name: '密码' }).fill('123456');
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForTimeout(3000);
    
    // 2. 进入我的工单
    console.log('进入我的工单...');
    await page.locator('span').filter({ hasText: '我的工单' }).first().click();
    await page.waitForTimeout(2000);
    await page.getByRole('menu').getByRole('menuitem', { name: '我的工单' }).click();
    await page.waitForTimeout(3000);
    
    // 3. 筛选病例监控
    console.log('筛选病例监控...');
    await page.getByRole('columnheader', { name: '工单类型' }).locator('img').click();
    await page.waitForTimeout(1000);
    await page.getByText('病例监控').click();
    await page.waitForTimeout(3000);
    
    // 4. 跳转到最后一页
    console.log('跳转到最后一页...');
    const pageButtons = await page.locator('li.number, li:has-text("1"), li:has-text("2"), li:has-text("3"), li:has-text("4"), li:has-text("5")').all();
    if (pageButtons.length > 0) {
      await pageButtons[pageButtons.length - 1].click();
      await page.waitForTimeout(3000);
      console.log('已跳转到最后一页');
    }
    
    // 5. 获取当前页的工单数量
    let totalWorkOrders = await page.locator('(//span[text()="查看"])').count();
    console.log(`当前页共有 ${totalWorkOrders} 个工单`);
    
    // 6. 只处理最后5个工单
    const processCount = Math.min(5, totalWorkOrders);
    console.log(`将处理当前页最后 ${processCount} 个工单（从下往上）`);
    
    const processedCases = [];
    
    // 7. 从最后一个开始，处理5个
    for (let i = 0; i < processCount; i++) {
      const currentOrder = totalWorkOrders - i;
      
      console.log(`\n${'='.repeat(50)}`);
      console.log(`处理第 ${i + 1}/${processCount} 个工单 (本页第 ${currentOrder} 个)`);
      console.log(`${'='.repeat(50)}\n`);
      
      const caseNumber = await processWorkOrder(page, currentOrder, i + 1, processCount);
      processedCases.push(caseNumber);
      
      if (i < processCount - 1) {
        console.log('返回工单列表页...');
        const breadcrumb = page.locator('.el-breadcrumb__item:first-child .el-breadcrumb__inner');
        if (await breadcrumb.count() > 0) {
          await breadcrumb.click();
        } else {
          await page.goBack();
        }
        await page.waitForTimeout(3000);
        await page.waitForSelector('(//span[text()="查看"])', { timeout: 10000 });
        totalWorkOrders = await page.locator('(//span[text()="查看"])').count();
      }
    }
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎉 成功处理 ${processCount} 个工单！`);
    console.log(`📋 已处理的病例编号: ${processedCases.join(', ')}`);
    console.log(`${'='.repeat(50)}`);
    
  } catch (error) {
    console.error('测试失败:', error);
    await page.screenshot({ path: 'error-screenshot.png' });
    throw error;
  }
});