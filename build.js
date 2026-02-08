import fs from 'fs'
import path from 'path'
import ignore from 'ignore'
import { build } from 'esbuild'
import { minify as minifyHTML } from 'html-minifier-terser'
import { minify as minifyJS } from 'terser'

const ig = ignore()
if (fs.existsSync('.gitignore')) ig.add(fs.readFileSync('.gitignore', 'utf8'))

const SRC = 'src'
const OUT = 'public'

const ensure = p => fs.mkdirSync(p, { recursive: true })

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
      \\ this website is not open source

    | LEGAL ------------------------------------------------
    "thatako.net" This site is not for Thatako School right now, but there is a plan wink-winked.
`

const banner = {
    html: `<!--${bannerText}-->\n`,
    js: `/**${bannerText}*/\n`,
    css: `/*${bannerText}*/\n`
}

const minifyHTMLFile = async file => {
    const src = fs.readFileSync(file, 'utf8')
    const out = await minifyHTML(src, {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeEmptyAttributes: true,
        minifyCSS: true,
        minifyJS: true,
        keepClosingSlash: true,
        html5: true
    })
    fs.writeFileSync(file, banner.html.trimEnd() + out)
}

const minifyJSFile = async (src, out) => {
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
    fs.writeFileSync(out, banner.js + r.code)
}

const walk = async dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const src = path.join(dir, e.name)
        const rel = path.relative(SRC, src).replace(/\\/g, '/')
        if (ig.ignores(rel)) continue

        const out = path.join(OUT, rel)

        if (e.isDirectory()) {
            ensure(out)
            await walk(src)
            continue
        }

        ensure(path.dirname(out))

        if (src.endsWith('.html')) {
            fs.copyFileSync(src, out)
            await minifyHTMLFile(out)
            continue
        }

        if (src.endsWith('.js')) {
            await minifyJSFile(src, out)
            continue
        }

        if (src.endsWith('.css')) {
            await build({
                entryPoints: [src],
                outfile: out,
                minify: true,
                banner: { css: banner.css }
            })
            continue
        }

        fs.copyFileSync(src, out)
    }
}

const copyRoot = (name, output = OUT) => {
    if (!fs.existsSync(name)) return
    fs.cpSync(name, path.join(output, name), { recursive: true })
}

(async () => {
    fs.rmSync(OUT, { recursive: true, force: true })
    ensure(OUT)

    await walk(SRC)
    // await minifyJSFile(
    //     'src/addondata.js',
    //     'api/addondata.js'
    // )

    copyRoot('img')
    // copyRoot('ads.txt')
    // copyRoot('sitemap.xml')
})()
