import { build } from 'vite'
await build({ configFile:false, publicDir:false, logLevel:'error', define:{'process.env.NODE_ENV':JSON.stringify('production')}, build:{target:'es2022',outDir:'workbench/public',emptyOutDir:false,minify:false,lib:{entry:'workbench/markdown.js',formats:['es'],fileName:()=>'markdown.js'},rolldownOptions:{output:{codeSplitting:false}}} })
