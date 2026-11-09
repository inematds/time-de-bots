import {packager} from '@electron/packager';
import {readFile} from 'node:fs/promises';
const edition=JSON.parse(await readFile(new URL('../edition.json',import.meta.url)));
const result=await packager({dir:'.',name:edition.name,platform:'darwin',arch:process.arch,out:'release',overwrite:true,icon:'assets/gratis.icns',appBundleId:edition.bundleId,extendInfo:'assets/mac-info.plist',extraResource:['assets/composio-cli','assets/models'],asar:{unpack:'**/*.{node,dylib}'},ignore:[/^\/(?:release|docs|test|data|scripts|\.cache|\.git|assets\/composio-cli|assets\/models)(?:\/|$)/,/^\/node_modules\/@openai\/codex-darwin-arm64(?:\/|$)/]});console.log(result.join('\n'));
