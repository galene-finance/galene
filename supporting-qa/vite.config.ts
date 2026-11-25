import original from '../ui-preview/vite.config';
import {resolve} from 'node:path';
export default {...original,root:import.meta.dirname,cacheDir:'/scratch/w19-vite',server:{...original.server,host:'0.0.0.0',port:5173,proxy:undefined},build:{outDir:'dist'}};
