import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig({root:resolve(import.meta.dirname), publicDir:resolve(import.meta.dirname,'../static'), plugins:[svelte({configFile:false}),tailwind()],resolve:{alias:{'$lib':resolve(import.meta.dirname,'../src/lib'),'$app/state':resolve(import.meta.dirname,'state.ts'),'$app/navigation':resolve(import.meta.dirname,'navigation.ts'),'$app/forms':resolve(import.meta.dirname,'forms.ts'),'$app/environment':resolve(import.meta.dirname,'environment.ts')}},cacheDir:'/scratch/galene-product-vite-cache',server:{host:'127.0.0.1',port:5173,strictPort:true,fs:{allow:[resolve(import.meta.dirname,'..')]}},build:{outDir:'dist'}});
