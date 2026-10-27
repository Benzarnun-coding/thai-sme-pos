// Privacy policy for the Meta app "Stat". Meta requires a public URL before an app can go live, and the app
// must be live for the Messenger webhook to receive events from the public. Since 27 Oct it also says the app asks
// customers for a missing ตำบล (tambonAsk.ts), which App Review for pages_messaging reads. Served under /webhook/ because
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
<li>ข้อความแชทระหว่างลูกค้ากับเพจ โดยลบเบอร์โทร อีเมล ตัวเลขยาว (เช่น เลขพัสดุ เลขบัญชี) และข้อความที่เป็นที่อยู่ออกก่อนบันทึก</li>
</ul>
<p>แอปไม่เก็บชื่อ รูป เบอร์โทร หรือที่อยู่ของลูกค้า</p>
<h2>ข้อความที่แอปส่งถึงลูกค้า</h2>
<p>เมื่อลูกค้าสั่งซื้อในแชทแล้วที่อยู่จัดส่งขาดตำบล/แขวง แอปส่งข้อความถามตำบลหนึ่งครั้งในแชทเดิม ภายใน 24 ชั่วโมงหลังข้อความล่าสุดของลูกค้า และนำคำตอบไปใส่ในบิลจัดส่งของร้าน แอปไม่ส่งโฆษณาหรือโปรโมชัน คำตอบอ่านแล้วไม่บันทึกเก็บไว้ บันทึกเพียงเลขบิลและเวลาที่ถาม (ไม่เกิน 2 วัน)</p>
<h2>การใช้ข้อมูล</h2>
<p>ใช้เพื่อวัดผลโฆษณาและปรับปรุงการตอบแชท/สินค้าของร้านเท่านั้น ไม่ขาย ไม่แบ่งปันให้บุคคลภายนอก ข้อความแชทเก็บไม่เกิน 30 วัน ข้อมูลอื่นเก็บไม่เกิน 90 วัน</p>
<h2>การลบข้อมูล</h2>
<p>ลูกค้าที่ต้องการให้ลบข้อมูลที่เกี่ยวกับตน ติดต่อเพจ "กางเกงยีนส์ไทย แด่คนล่าฝัน" ทาง Messenger ร้านจะลบภายใน 7 วัน</p>
<hr>
<p lang="en">"Stat" is an internal tool of the PkJeans shop (Facebook page "กางเกงยีนส์ไทย แด่คนล่าฝัน") used by shop staff to read Meta ad performance and to learn which ad a customer's chat came from. When a customer opens a chat from an ad, the app stores the page-scoped user id, the ad id and the time. It also stores the text of messages between the customer and the page, with phone numbers, e-mail addresses, long numbers (tracking, bank) and addresses removed before storage; no names or photos. Data is used only to measure the shop's ads and improve its replies and products, is never sold or shared; message text is kept for at most 30 days, other data for at most 90 days. When a customer orders in the chat and the shipping address lacks a subdistrict, the app sends one message in that conversation, within 24 hours of the customer's last message, asking for the subdistrict, and writes the answer into the shop's shipping bill. It sends no promotions. The answer is read, not stored; only the bill number and the time asked are kept, for at most 2 days. To have your data deleted, message the page; it will be removed within 7 days.</p>
</body></html>`;
