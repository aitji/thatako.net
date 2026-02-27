import fs from 'fs'
import path from 'path'
import ignore from 'ignore'
import { build } from 'esbuild'
import { minify, minify as minifyHTML } from 'html-minifier-terser'
import { minify as minifyJS } from 'terser'

const ig = ignore()
if (fs.existsSync('.gitignore')) ig.add(fs.readFileSync('.gitignore', 'utf8'))

const SRC = 'src'
const OUT = 'public'
const WATCH = process.argv.includes('--watch')

const ensure = p => fs.mkdirSync(p, { recursive: true })

const google = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-MB904QRERQ"></script><script>function gtag(){dataLayer.push(arguments)}window.dataLayer=window.dataLayer||[],gtag("js",new Date),gtag("config","G-MB904QRERQ");</script>`
const YEAR = new Date().getFullYear()
const bannerText = `
                          ,
   ,-.       _,---._ __  / \\
  /  )    .-'       \`./ /   \\
 (  (   ,'            \`/    /|
  \\  \`-"             \\'\\   / |
   \`.              ,  \\ \\ /  |
    /\`.          ,'-\`----Y   |
   (            ;        |   '
   |  ,-.    ,-'         |  /
   |  | (   |            | /
   )  |  \\  \`.___________|/
   \`--'   \`--'

    ©thatako.net™ 2026-${YEAR}
    Proprietary software. All rights reserved.
    No redistribution, modification, or reuse without permission.

    | ABOUT ------------------------------------------------
    I'm aitji (also known as "Suriya Inchoo").
    Curious council student, full-stack developer, and code optimizer.
    I like building cool things.

    Code was big. Brain was tired.
    Minify button fixed everything.

    | CONTACT ----------------------------------------------
    Email: aitji@duck.com
      \\ preferred method
    Discord: @aitji (aitji.is-a.dev/discord)
      \\ tickets are fastest, DMs may be ignored
    GitHub: github.com/aitji

    | LEGAL ------------------------------------------------
    "thatako.net" This site is build for Thatako School, but fully build by @aitji wink-winked.
`

const banner = {
    html: `<!--${bannerText}-->\n`,
    js: `/**${bannerText}*/\n`,
    css: `/*${bannerText}*/\n`
}

const minifyJSONFile = async file => {
    try {
        if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);

        const src = fs.readFileSync(file, 'utf8')
        const out = JSON.stringify(JSON.parse(src))
        fs.writeFileSync(file, out)
    } catch (error) { console.error(`[JSON] error processing ${file}: ${error.message}`) }
}

const minifyHTMLFile = async file => {
    try {
        let src = fs.readFileSync(file, 'utf8')
        if (!WATCH) src = src.replace('</head>', `${google}</head>`)
        else src = src.replaceAll('thatako.net', 'dev.thatako.net')

        // <script type="application/ld+json">{"@context": "https://schema.org"...}</script>
        const regex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i
        const match = src.match(regex)

        if (match) {
            const jsonSrc = match[1]
            const jsonOut = JSON.stringify(JSON.parse(jsonSrc))
            src = src.replace(jsonSrc, jsonOut)
        }

        let out = await minifyHTML(src, {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeEmptyAttributes: true,
            minifyCSS: true,
            minifyJS: true,
            keepClosingSlash: true,
            html5: true
        })
        fs.writeFileSync(file, banner.html + out)
    } catch (error) { console.error(`[HTML] error processing ${file}: ${error.message}`) }
}

const minifyJSFile = async (src, out) => {
    try {
        const code = fs.readFileSync(src, 'utf8')
        const r = await minifyJS(code, {
            compress: {
                passes: 3,
                drop_console: true,
                unsafe: true
            },
            mangle: { toplevel: true },
            format: { comments: false }
        })

        if (WATCH) r.code = r.code.replaceAll('thatako.net', 'dev.thatako.net')
        fs.writeFileSync(out, banner.js + r.code)
    } catch (error) { console.error(`[HTML] error processing ${file}: ${error.message}`) }
}

const esbuildContexts = new Map() // esbuild context cache for CSS watch mode
const processFile = async (src, out) => {
    ensure(path.dirname(out))

    if (src.endsWith('.html')) {
        fs.copyFileSync(src, out)
        await minifyHTMLFile(out)
        return
    }

    if (src.endsWith('.js')) {
        await minifyJSFile(src, out)
        return
    }

    if (src.endsWith('.json')) {
        await minifyJSONFile(src)
        return
    }

    if (src.endsWith('.css')) {
        if (WATCH) {
            // dispose old context if re-processing
            if (esbuildContexts.has(src)) {
                await esbuildContexts.get(src).dispose()
                esbuildContexts.delete(src)
            }
            const ctx = await build({
                entryPoints: [src],
                outfile: out,
                minify: true,
                banner: { css: banner.css }
            })

            // esbuild in watch mode returns context with "watch"
            // but using "fs.watch", just build normally
        }
        try {
            await build({
                entryPoints: [src],
                outfile: out,
                minify: true,
                legalComments: "none",
                banner: { css: banner.css }
            })
        } catch (error) { console.error(`[CSS] error processing file: ${error.message}`) }
        return
    }

    fs.copyFileSync(src, out)
}

const srcToOut = src => path.join(OUT, path.relative(SRC, src).replace(/\\/g, '/'))
const walk = async dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const src = path.join(dir, e.name)
        const rel = path.relative(SRC, src).replace(/\\/g, '/')
        if (ig.ignores(rel)) continue

        const out = srcToOut(src)

        if (e.isDirectory()) {
            ensure(out)
            await walk(src)
            continue
        }

        await processFile(src, out)
    }
}

const copyRoot = (name, output = OUT) => {
    if (!fs.existsSync(name)) return
    fs.cpSync(name, path.join(output, name), { recursive: true })
}

const startWatch = () => {
    console.log(`[watch] Watching ${SRC}/ for changes...`)

    fs.watch(SRC, { recursive: true }, async (event, filename) => {
        if (!filename) return

        const rel = filename.replace(/\\/g, '/')
        if (ig.ignores(rel)) return

        const src = path.join(SRC, rel)
        const out = path.join(OUT, rel)

        // small debounce per file ti avoid duplicate events
        const key = src
        if (startWatch._timers?.has(key)) return
        if (!startWatch._timers) startWatch._timers = new Map()
        startWatch._timers.set(key, true)
        setTimeout(() => startWatch._timers.delete(key), 100)

        if (!fs.existsSync(src)) { // file del
            if (fs.existsSync(out)) {
                try {
                    fs.rmSync(out, { recursive: true, force: true })
                    console.log(`[watch] deleted: ${out}`)
                } catch (e) {
                    console.error(`[watch] failed to delete ${out}:`, e.message)
                }
            }
            return
        }

        const stat = fs.statSync(src)
        if (stat.isDirectory()) { // new dir created
            ensure(out)
            console.log(`[watch] dir created: ${out}`)
            return
        }

        try {
            await processFile(src, out)
            console.log(`[watch] ${event === 'rename' ? 'Created' : 'Updated'}: ${src} → ${out}`)
        } catch (e) { console.error(`[watch] Error processing ${src}:`, e.message) }
    })
}

(async () => {
    if (!WATCH) { // clean build
        fs.rmSync(OUT, { recursive: true, force: true })
        ensure(OUT)
    } else ensure(OUT) // watch: ensure output exists, don't wipe it 

    await walk(SRC)
    // await minifyJSFile(
    //     'src/addondata.js',
    //     'api/addondata.js'
    // )

    copyRoot('img')
    // copyRoot('ads.txt')
    // copyRoot('sitemap.xml')

    if (WATCH) startWatch()
    else console.log('Build complete.')
})()