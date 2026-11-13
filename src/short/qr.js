const CAP = {
    N: {
        L: [41,77,127,187,255,322,370,461,552,652,772,883,1022,1101,1250,1408,1548,1725,1903,2061,2232,2409,2620,2812,3057,3283,3517,3669,3909,4158,4417,4686,4965,5253,5529,5836,6153,6479,6743,7089],
        M: [34,63,101,149,202,255,293,365,432,513,604,691,796,871,991,1082,1212,1346,1500,1600,1708,1872,2059,2188,2395,2544,2701,2857,3035,3289,3486,3693,3909,4134,4343,4588,4775,5039,5313,5596],
        Q: [27,48,77,111,144,178,207,259,312,364,427,489,580,621,703,775,876,948,1063,1159,1224,1358,1468,1588,1718,1804,1933,2085,2181,2358,2473,2670,2805,2949,3081,3244,3417,3599,3791,3993],
        H: [17,34,58,82,106,139,154,202,235,288,331,374,427,468,530,602,674,746,813,919,969,1056,1108,1228,1286,1425,1501,1581,1677,1782,1897,2022,2157,2301,2361,2524,2625,2735,2927,3057]
    },
    A: {
        L: [25,47,77,114,154,195,224,279,335,395,468,535,619,667,758,854,938,1046,1153,1249,1352,1460,1588,1704,1853,1990,2132,2223,2369,2520,2677,2840,3009,3183,3351,3537,3729,3927,4087,4296],
        M: [20,38,61,90,122,154,178,221,262,311,366,419,483,528,600,656,734,816,909,970,1035,1134,1248,1326,1451,1542,1637,1732,1839,1994,2113,2238,2369,2506,2632,2780,2894,3054,3220,3391],
        Q: [16,29,47,67,87,108,125,157,189,221,259,296,352,376,426,470,531,574,644,702,742,823,890,963,1041,1094,1172,1263,1322,1429,1499,1618,1700,1787,1867,1966,2071,2181,2298,2420],
        H: [10,20,35,50,64,84,93,122,143,174,200,227,259,283,321,365,408,452,493,557,587,640,672,744,779,864,910,958,1016,1080,1150,1226,1307,1394,1431,1530,1591,1658,1774,1852]
    },
    B: {
        L: [17,32,53,78,106,134,154,192,230,271,321,367,425,458,520,586,644,718,792,858,929,1003,1091,1171,1273,1367,1465,1528,1628,1732,1840,1952,2068,2188,2303,2431,2563,2699,2809,2953],
        M: [14,26,42,62,84,106,122,152,180,213,251,287,331,362,412,450,504,560,624,666,711,779,857,911,997,1059,1125,1190,1264,1370,1452,1538,1628,1722,1809,1911,1989,2099,2213,2331],
        Q: [11,20,32,46,60,74,86,108,130,151,177,203,241,258,292,322,364,394,442,482,509,565,611,661,715,751,805,868,908,982,1030,1112,1168,1228,1283,1351,1423,1499,1579,1663],
        H: [7,14,24,34,44,58,64,84,98,119,137,155,177,194,220,250,280,310,338,382,403,439,461,511,535,593,625,658,698,742,790,842,898,958,983,1051,1093,1139,1219,1273]
    }
}

const MODE = { N: 'Numeric', A: 'Alphanumeric', B: 'Byte' }
const KEY = { Numeric: 'N', Alphanumeric: 'A', Byte: 'B' }
const ORDER = ['H', 'Q', 'M', 'L']
export const RECOVER = { L: 7, M: 15, Q: 25, H: 30 }
export const toQrData = text => {
    const b = new TextEncoder().encode(text)
    let s = ''
    for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
    return s
}
export const detectMode = data =>
    /^[0-9]*$/.test(data) ? MODE.N
        : /^[0-9A-Z $%*+\-./:]*$/.test(data) ? MODE.A
            : MODE.B

export const minVersion = (mode, ecc, len) => CAP[KEY[mode]][ecc].findIndex(c => c >= len) + 1
export const upperUrl = text => {
    const m = /^(https?):\/\/([^/?#]+)(.*)$/i.exec(text)
    if (!m || /[a-z]/.test(m[3])) return null
    const up = text.toUpperCase()
    return detectMode(toQrData(up)) === MODE.A ? up : null
}

const versions = (data) => {
    const mode = detectMode(data), len = data.length
    return { mode, len, ver: Object.fromEntries(ORDER.map(e => [e, minVersion(mode, e, len)])) }
}

export const planQr = (text, { ecc = 'auto', logo = false } = {}) => {
    let data = toQrData(text || '')
    if (!data) return null

    let { mode, len, ver } = versions(data)
    let optimized = false
    const alt = upperUrl(text)
    if (alt) {
        const a = versions(toQrData(alt))
        if (a.ver.L && (!ver.L || a.ver.L < ver.L)) { data = toQrData(alt); ({ mode, len, ver } = a); optimized = true }
    }
    if (!ver.L) return { data, mode, len, tooLong: true }

    const fits = ORDER.filter(e => ver[e])
    let pick, why
    if (ecc !== 'auto' && ver[ecc]) [pick, why] = [ecc, 'manual']
    else if (ecc !== 'auto') [pick, why] = [fits[0], 'fallback']
    else if (logo) [pick, why] = [fits[0], 'logo']
    else [pick, why] = [fits.find(e => ver[e] === ver.L), 'auto']

    const version = ver[pick]
    return { data, mode, len, ecc: pick, why, version, modules: 17 + 4 * version, recover: RECOVER[pick], smallest: ver.L, optimized }
}

export const snapSize = (size, modules, quiet) => {
    const cells = modules + 2 * quiet
    const px = Math.max(1, Math.floor(size / cells))
    return { size: px * cells, margin: px * quiet, px }
}

export const marginPx = (size, modules, quiet) => Math.round(size * quiet / (modules + 2 * quiet))
const HEX = /^#[0-9a-f]{6}$/i
const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
}
export const colorIssue = (fg, bg) => {
    if (!HEX.test(fg) || !HEX.test(bg)) return null
    if (lum(fg) > lum(bg)) return 'inverted'
    return contrast(fg, bg) < 4 ? 'low' : null
}
