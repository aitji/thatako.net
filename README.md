# ศูนย์รวมข้อมูล [thatako.net](https://thatako.net)

> [!NOTE]
> โครงสร้างพื้นฐานสำหรับโรงเรียนท่าตะโกพิทยาคม - ตัวย่อ URL, รหัส QR-CODE, โดเมนย่อย, API สาธารณะ และอื่น ๆ อีกมากมายที่จะตามมา สำหรับนักเรียนและคุณครู

## สารบัญ
- [ศูนย์รวมข้อมูล thatako.net](#ศูนย์รวมข้อมูล-thatakonet)
  - [สารบัญ](#สารบัญ)
  - [ภาพรวม](#ภาพรวม)
  - [บริการ](#บริการ)
    - [ตัวย่อ URL, go.thatako.net](#ตัวย่อ-url-gothatakonet)
      - [ความปลอดภัยและการใช้งานที่เหมาะสม](#ความปลอดภัยและการใช้งานที่เหมาะสม)
    - [โดเมนย่อย สำหรับนักเรียนและคุณครู *(แผน)*](#โดเมนย่อย-สำหรับนักเรียนและคุณครู-แผน)
      - [วัตถุประสงค์](#วัตถุประสงค์)
  - [โครงสร้างพื้นฐาน](#โครงสร้างพื้นฐาน)
    - [หน้าบ้าน](#หน้าบ้าน)
    - [CDN / Proxy](#cdn--proxy)
    - [หลังบ้าน](#หลังบ้าน)
  - [แผนการทำงาน](#แผนการทำงาน)
    - [อยู่ระหว่างดำเนินการ](#อยู่ระหว่างดำเนินการ)
    - [วางแผนแล้ว](#วางแผนแล้ว)
    - [สมบูรณ์](#สมบูรณ์)
  - [โดเมนย่อยปัจจุบัน](#โดเมนย่อยปัจจุบัน)
  - [วิธีโฮสติ้งเว็บไซต์ใช้ส่วนตัว](#วิธีโฮสติ้งเว็บไซต์ใช้ส่วนตัว)
    - [สิ่งที่ต้องมี](#สิ่งที่ต้องมี)
    - [คัดลอกเว็บไซต์ thatako.net](#คัดลอกเว็บไซต์-thatakonet)
    - [เปิดเว็บไซต์บนเครื่องแบบ HTTP](#เปิดเว็บไซต์บนเครื่องแบบ-http)
    - [เปิดเว็บไซต์บนเครื่องแบบ HTTPS](#เปิดเว็บไซต์บนเครื่องแบบ-https)
        - [ติดตั้ง local CA (ทำครั้งเดียว)](#ติดตั้ง-local-ca-ทำครั้งเดียว)
      - [เปิดเว็บไซต์แบบ HTTPS](#เปิดเว็บไซต์แบบ-https)
  - [ติดต่อ](#ติดต่อ)

## ภาพรวม

โดย [thatako.net](https://thatako.net) ให้บริการด้านโครงสร้างพื้นฐานสำหรับการใช้งานของโรงเรียนท่าตะโกพิทยาคม

- [x] ตัวย่อ URL - `go.thatako.net`
- [x] ตัวสร้าง QR-CODE
- [ ] โดเมนย่อย สำหรับนักเรียนและคุณครู\* - `[name].id.thatako.net` *(แผน)*
- [ ] API สาธารณะ *(แผน)*
- [ ] หน้าสถานะการให้บริการ *(แผน)*

## บริการ

### ตัวย่อ URL, [go.thatako.net](https://thatako.net/short)

สร้างลิงก์สั้นแบบง่าย ๆ พร้อมตัวเลือกในการใส่ Slug เอง และรองรับการสร้าง QR CODE ด้วย

```
GET https://go.thatako.net/{slug}
Host: go.thatako.net

→ (302 redirect)
HTTP/1.1 302 Found
Location: https://example.com
```

- Slug แบบกำหนดเอง
- การแก้ไข/ลบ Slug ผ่านรหัสลับ
- สร้าง QR CODE
- ออกแบบมาเพื่อการแบ่งปันในชั้นเรียน

#### ความปลอดภัยและการใช้งานที่เหมาะสม

โดยทั่วไปตัวย่อ URL จะไม่มีวันหมดอายุ หากผู้ใช้ไม่แก้ไขหรือลบตัวย่อ URL ของตน
แต่หากลิงก์ไม่สามารถเข้าถึงได้ นั่นอาจมาจากเหตุผลดังต่อไปนี้

- [ ] ห้ามใช้ตัวย่อ URL เพื่อเนื้อหา NSFW (เนื้อหาสำหรับผู้ใหญ่)
- [ ] ห้ามใช้ตัวย่อ URL เพื่อเนื้อหาที่ผิดต่อกฎหมาย
- [ ] ห้ามใช้ตัวย่อ URL สำหรับการ Phishing หรือ Malware
- [x] อนุญาตให้ใช้ตัวย่อ URL ได้ทุกที่ ไม่ว่าจะอยู่ที่โรงเรียนท่าตะโกพิทยาคมหรือไม่ก็ตาม
- [x] อนุญาตให้ทั้งคุณครูและนักเรียน สร้าง ลบ และแก้ไขตัวย่อ URL ของตนเองได้

> [!CAUTION]
> หากเห็นว่าไม่สมควร ผู้ดูแลมีสิทธิ์ระงับการใช้งาน ของตัวย่อ URL ดังกล่าว

สามารถเข้าใช้งานได้ [ที่นี่](https://thatako.net/short)

### โดเมนย่อย สำหรับนักเรียนและคุณครู *(แผน)*

> [!IMPORTANT]
> บริการนี้ยังไม่เปิดให้ใช้งาน เป็นเพียงแค่แผนที่วางไว้

นักเรียนและคุณครู* จะสามารถขอใช้โดเมนย่อยได้ฟรี ในรูปแบบ
```
[name].id.thatako.net
```

<small>*คุณครูอาจสามารถ ปรับแก้ที่อยู่ของโดเมนย่อยได้มากกว่าเช่น openhouse.thatako.net</small>

#### วัตถุประสงค์

- โฮสติ้งโปรเจคส่วนตัวของนักเรียน
- สร้างพอร์ตเก็บผลงาน
- ไม่จำเป็นต้องซื้อโดเมน

ยังไม่เปิดให้ลงทะเบียน ในตอนนี้

## โครงสร้างพื้นฐาน

### หน้าบ้าน
- [Vercel](https://vercel.com)
- Static site + [Edge Functions](https://vercel.com/docs/functions)

### CDN / Proxy
- [Cloudflare](https://www.cloudflare.com/)
- [DNS](https://www.cloudflare.com/application-services/products/dns) + [WAF](https://developers.cloudflare.com/waf/)
- [Orange-cloud](https://www.cloudflare.com/impact-portal/website-security) enabled at root domain

### หลังบ้าน
- [Dragonhispeed](https://www.dragonhispeed.com)
- [Cloudflare Workers](https://workers.cloudflare.com)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
- Primary API server

## แผนการทำงาน

### อยู่ระหว่างดำเนินการ
- ตัวย่อ URL / QR CODE

### วางแผนแล้ว
- [ ] โดเมนย่อยของนักเรียนและคุณครู `[name].id.thatako.net`
- [ ] API สาธารณะสำหรับนักเรียนและครู
- [ ] status.thatako.net

### สมบูรณ์
- [x] ออกแบบเว็บไซต์ให้ดูดีขึ้น
- [x] council.thatako.net
- [x] pr.thatako.net
- [x] ย้ายระบบ DNS ไปยัง Cloudflare
- [x] โดเมนหลักถูก Proxy ผ่าน Orange Cloud
- [x] เว็บไซต์และระบบภายในได้รับการสร้างใหม่

## โดเมนย่อยปัจจุบัน

- [council.thatako.net](https://council.thatako.net)
- [pr.thatako.net](https://pr.thatako.net)
- [go.thatako.net](https://go.thatako.net)

## วิธีโฮสติ้งเว็บไซต์ใช้ส่วนตัว

หากต้องการทดสอบระบบสามารถ โฮสติ้งเว็บไซต์เพื่อใช้ส่วนตัวได้ด้วยคำสั่งนี้

### สิ่งที่ต้องมี

-  โปรแกรมสำหรับเขียนโคด
   -  แนะนำ [Visual Studio Code](https://code.visualstudio.com/)
-  [Node.js LTS](https://nodejs.org/en)
   -  แนะนำ v20.x หรือใหม่กว่า

### คัดลอกเว็บไซต์ thatako.net

```
git clone https://github.com/aitji/thatako.net.git
cd thatako.net
npm install
```

### เปิดเว็บไซต์บนเครื่องแบบ HTTP

```
npm run dev:http_live
```

<small>เว็บไซต์จะถูกเปิดใน http://localhost:3000 พร้อม live reload อัตโนมัติเมื่อมีการแก้ไขไฟล์</small>

### เปิดเว็บไซต์บนเครื่องแบบ HTTPS

ต้องติดตั้ง [mkcert](https://github.com/FiloSottile/mkcert) ก่อน

##### ติดตั้ง local CA (ทำครั้งเดียว)

```
mkcert -install
mkcert localhost 127.0.0.1 ::1
```

#### เปิดเว็บไซต์แบบ HTTPS

```
npm run dev:https_live
```

<small>เว็บไซต์จะถูกเปิดใน https://localhost:3443 พร้อม live reload อัตโนมัติเมื่อมีการแก้ไขไฟล์
<br>Browser อาจไม่เชื่อถือการจดทะเบียนเองแบบนี้ แต่สามารถใช้เว็บไซต์แบบ HTTPS ได้ปกติ</small>

## ติดต่อ

- Email: [aitji@duck.com](mailto:aitji@duck.com)
- Discord: [aitji](https://aitji.is-a.dev/discord)
- GitHub: [aitji](https://github.com/aitji)

```
©2026 thatako.net™ Proprietary software. All rights reserved. No redistribution, modification, or reuse without permission.

Infra version : v0.4-alpha
Last updated  : Jan 2026
Author        : aitji
```