import {createHash,randomBytes} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import type {Plugin} from 'vite'
const required=['worker.min.js','tesseract-core-simd-lstm.wasm.js','chi_sim.traineddata','eng.traineddata']
export function ocrOfflineManifest():Plugin{const buildId=randomBytes(32).toString('hex');let output='dist',runtimePaths:string[]=[];return {config(){return {define:{'import.meta.env.TONGYE_OCR_BUILD_ID':JSON.stringify(buildId)}}},configResolved(config){output=config.build.outDir},name:'ocr-offline-manifest',enforce:'post',generateBundle(_options,bundle){
 const paths=new Set<string>(),visit=(name:string)=>{if(paths.has(name))return;paths.add(name);const entry=bundle[name];if(entry?.type==='chunk')for(const child of [...entry.imports,...entry.dynamicImports])visit(child)}
 for(const [name,entry] of Object.entries(bundle))if(entry.type==='chunk'&&/^ocr-(engine|recognition)$/.test(entry.name))visit(name)
 if(![...paths].some(path=>/ocr-engine-/.test(path))||![...paths].some(path=>/ocr-recognition-/.test(path)))throw new Error('OCR runtime chunks missing from offline manifest')
 runtimePaths=[...paths].sort()
 const resources=[...required.map(name=>{const bytes=readFileSync(resolve('public/tesseract',name));return {path:'tesseract/'+name,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}),...[...paths].sort().map(path=>{const entry=bundle[path];if(!entry)throw new Error(`OCR dependency missing: ${path}`);const bytes=Buffer.from(entry.type==='chunk'?entry.code:entry.source);return {path,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}})]
 const manifest={format:1,buildId,revision:createHash('sha256').update(JSON.stringify(resources)).digest('hex'),resources}
 this.emitFile({type:'asset',fileName:'ocr-offline-manifest.json',source:JSON.stringify(manifest)})
},writeBundle(){
 // Vite rewrites preload placeholders late in generateBundle. Hash final disk
 // bytes after those rewrites and before the PWA closeBundle precache scan.
 const resources=[...required.map(name=>'tesseract/'+name),...runtimePaths].map(path=>{const bytes=readFileSync(resolve(output,path));return {path,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}})
 const manifest={format:1,buildId,revision:createHash('sha256').update(JSON.stringify(resources)).digest('hex'),resources};writeFileSync(resolve(output,'ocr-offline-manifest.json'),JSON.stringify(manifest))
}}}
