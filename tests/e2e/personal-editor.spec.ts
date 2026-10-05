import {customArrangement} from './ui-helpers'
import {API_BASE} from './api-base'
import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import type {EventPackage} from '../../shared/types'
test('个人新安排关闭不生成忙碌，刷新恢复编辑稿后保存分钟',async({page,request})=>{
 const token='b'.repeat(64);await request.post(`${API_BASE}/api/v1/admin/session`,{data:{rootToken:'a'.repeat(64),sessionToken:token}});const pack=JSON.parse(readFileSync('examples/event-minimal.json','utf8')) as EventPackage;pack.event.id='personal-editor-'+randomUUID();pack.event.title='个人编辑隔离验收';const published=await request.post(`${API_BASE}/api/v1/admin/events`,{headers:{Authorization:'Bearer '+token},data:{eventPackage:pack,status:'published',expectedRevision:0,operationId:randomUUID()}});expect(published.ok()).toBe(true);
 await page.goto('/events/'+pack.event.id+'?view=plan');await page.getByRole('button',{name:'日程',exact:true}).click();await customArrangement(page);await page.getByRole('dialog',{name:'个人安排'}).getByLabel('活动名').fill('未保存编辑稿');await page.keyboard.press('Escape');await expect(page.getByText('当天还没有安排')).toBeVisible();await page.reload();await page.getByRole('button',{name:'日程',exact:true}).click();await customArrangement(page);const sheet=page.getByRole('dialog',{name:'个人安排'});await expect(sheet.getByLabel('活动名')).toHaveValue('未保存编辑稿');await sheet.getByLabel('开始时间',{exact:true}).fill('13:07');await sheet.getByLabel('结束时间',{exact:true}).fill('13:52');await sheet.getByRole('button',{name:'加入计划'}).click();await expect(page.getByRole('button',{name:/13:07.*13:52.*未保存编辑稿/})).toBeVisible();await page.getByRole('button',{name:'保存个人计划'}).click();await expect(page.getByRole('status').filter({hasText:'已保存到云端'})).toBeVisible();await page.reload();await page.getByRole('button',{name:'日程',exact:true}).click();await expect(page.getByRole('button',{name:/13:07.*13:52.*未保存编辑稿/})).toBeVisible();
})
