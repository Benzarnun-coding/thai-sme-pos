// Privacy policy for the Meta app "Stat". Meta requires a public URL before an app can go live, and the app
// must be live for the Messenger webhook to receive events from the public. Served under /webhook/ because
// that prefix is the one path Cloudflare Access leaves open.

export const PRIVACY_HTML = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>นโยบายความเป็นส่วนตัว — PkJeans Ads (Stat)</title>
<style>body{font:16px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#222}h1{font-size:24px}h2{font-size:18px;margin-top:28px}</style>
</head><body>
<h1>นโยบายความเป็นส่วนตัว / Privacy Policy</h1>
<p>แอป "Stat" เป็นเครื่องมือภายในของร้าน PkJeans (เพจ "กางเกงยีนส์ไทย แด่คนล่าฝัน") ใช้ดูผลโฆษณาบน Meta และดูว่าลูกค้าที่ทักแชทมาจากโฆษณาตัวไหน ใช้งานโดยทีมงานของร้านเท่านั้น ไม่เปิดให้บุคคลทั่วไปใช้</p>
<h2>ข้อมูลที่เก็บ</h2>
<ul>
<li>ข้อมูลผลโฆษณาจากบัญชีโฆษณาของร้าน (ค่าใช้จ่าย ยอดขาย จำนวนออเดอร์)</li>
<li>เมื่อลูกค้าเปิดแชทจากโฆษณา: รหัสผู้ใช้เฉพาะเพจ (page-scoped id) รหัสโฆษณา และเวลา</li>
</ul>
<p>แอปไม่เก็บชื่อ รูป เบอร์โทร ที่อยู่ หรือข้อความแชทของลูกค้า และไม่ส่งข้อความถึงลูกค้า</p>
<h2>การใช้ข้อมูล</h2>
<p>ใช้เพื่อวัดผลโฆษณาของร้านเท่านั้น ไม่ขาย ไม่แบ่งปันให้บุคคลภายนอก ข้อมูลเก็บไว้ไม่เกิน 90 วัน</p>
<h2>การลบข้อมูล</h2>
<p>ลูกค้าที่ต้องการให้ลบข้อมูลที่เกี่ยวกับตน ติดต่อเพจ "กางเกงยีนส์ไทย แด่คนล่าฝัน" ทาง Messenger ร้านจะลบภายใน 7 วัน</p>
<hr>
<p lang="en">"Stat" is an internal tool of the PkJeans shop (Facebook page "กางเกงยีนส์ไทย แด่คนล่าฝัน") used by shop staff to read Meta ad performance and to learn which ad a customer's chat came from. When a customer opens a chat from an ad, the app stores the page-scoped user id, the ad id and the time — no names, photos, phone numbers, addresses or message content. Data is used only to measure the shop's ads, is never sold or shared, and is kept for at most 90 days. To have your data deleted, message the page; it will be removed within 7 days.</p>
</body></html>`;
