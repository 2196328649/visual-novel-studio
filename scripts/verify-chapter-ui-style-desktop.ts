import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { launchDesktopFixture } from './lib/desktop-fixture';
const root=path.resolve('.'),output=path.resolve(process.argv[2]);
const app=await launchDesktopFixture({root,projectFile:path.join(output,'project.vns.json'),profile:path.join(output,'profile')}),page=await app.firstWindow();
try {
 await expect(page.locator('.project-title strong')).toHaveText('章节样式验收',{timeout:45000});
 await page.locator('[data-workspace-tab="ui"]').click();
 await page.getByLabel('设计页面', { exact: true }).selectOption({ label: '章节标题' });
 const items=page.locator('.ui-canvas .ui-chapter-text');await expect(items).toHaveCount(2);
 const styles=await items.evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node);const text=node.querySelector('span')!;const range=document.createRange();range.selectNodeContents(text);const box=node.getBoundingClientRect(),glyph=range.getBoundingClientRect();return {align:style.textAlign,fontSize:parseFloat(style.fontSize),left:glyph.left-box.left,right:box.right-glyph.right,width:box.width};}));
 assert.equal(styles[0].align,'left');assert.equal(styles[1].align,'right');assert.ok(styles[0].left<3&&styles[1].right<3,JSON.stringify(styles));
 await page.screenshot({path:path.join(output,'desktop.png')});
 await fs.writeFile(path.join(output,'desktop-report.json'),JSON.stringify({status:'passed',styles},null,2));
}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>undefined);await app.close();}
