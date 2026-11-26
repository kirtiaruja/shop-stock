# StockPilot — shop stock management

Web app for your shop: sales and purchases using a barcode scanner, products (add one by one or import from Excel), customers, and staff logins with Admin / Co-admin / Salesman roles. Works on a computer and on a phone.

**Stack:** React + TypeScript + Vite + Tailwind (frontend) · Supabase (Postgres database + login).

---

## 1. Set up Supabase (one time, about 5 minutes)

1. Go to <https://supabase.com>, sign up, and click **New project**. Pick the **Mumbai (ap-south-1)** region so it's fast from India. Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**. You should see "Success". Then do the same with `supabase/002_credit_payments.sql` (credit, payments and suppliers). Both scripts can safely be run again later.
3. Open **Project Settings → API** (or the **Connect** button) and copy:
   - **Project URL**
   - **anon / publishable key** (never use the `service_role` / secret key in this app)
4. Optional: **Authentication → Sign In / Providers → Email**. Turn off **Confirm email** if you don't want staff to have to click an email link before they can log in.

## 2. Run it on your computer

```bash
cd D:\kirti\shop-stock\stockPilot
copy .env.example .env      # then open .env and paste the URL + key, plus your shop name
npm install
npm run dev
```

Open the address it shows (usually http://localhost:5173).

**First login:** click **Create account**. The **first account ever created becomes Admin** automatically.

## 3. Load your products

As Admin, go to **Products → Import Excel** and choose your `Export_Items.xlsx`. It reads the same columns:
Item name*, Item code, Category, HSN, Default Mrp, Sale price, Purchase price, Online Store Price, Discount Type, Sale Discount, Current stock quantity, Minimum stock quantity, Item Location, Tax Rate, Inclusive Of Tax, Base Unit (x), Secondary Unit (y), Conversion Rate.

- Products are matched by **Item code**, then by **Item name**. Matches are updated and new products are added, so importing the same file twice never makes duplicates.
- Untick "Set stock from the file" if you only want to update prices and details and keep the current stock.
- **Export** downloads all products in the same layout. You can edit it in Excel and import it back.

## 4. Add staff

Each staff member opens the app and clicks **Create account**. They wait on an "approval" screen until you (Admin) go to **Users**, tick **Active**, and choose their role.

| Can do | Admin | Co-admin | Salesman |
|---|:-:|:-:|:-:|
| New sale, print bill | ✓ | ✓ | ✓ |
| See sales history | all | all | own bills only |
| Add / edit customers | ✓ | ✓ | ✓ |
| View products & stock | ✓ | ✓ | ✓ (no purchase price) |
| Add / edit products, Excel import & export | ✓ | ✓ | – |
| New purchase, purchase history | ✓ | ✓ | – |
| Delete bills / purchases (stock is restored) | ✓ | – | – |
| Credit bills, receive customer payments | ✓ | ✓ | ✓ |
| Pay suppliers, suppliers list, full payments ledger | ✓ | ✓ | own receipts only |
| Delete payment entries | ✓ | – | – |
| Delete products / customers | ✓ | – | – |
| Manage users & roles | ✓ | – | – |

These rules are enforced **in the database** (row-level security + checked functions), not only by hiding buttons.

## 5. Credit (udhaar) and payments

- On **New sale** / **New purchase**, choose **Paid now** (pick Cash / UPI / Card / Bank) or **Credit (udhaar)**. With credit, enter how much is paid now (can be 0). The rest stays due on that bill. A credit bill needs a customer / supplier.
- **Every payment is recorded in the Payments ledger**, linked to its bill number (sales) or purchase number: date, amount, mode, who entered it, note (e.g. UPI ref).
- **Dues (udhaar)** lists who owes you and whom you owe. Tap **Receive** / **Pay**: put the money on one bill, or let it settle the oldest bills first automatically. Each bill touched gets its own ledger entry.
- Open any bill from **Sales** / **Purchases** to see its payments and **Receive payment** / **Pay supplier** against it. Tick **Unpaid only** to list every bill with a balance.
- Only Admin can delete a wrong payment entry (the bill then shows that amount as due again). Deleting a bill also removes its payments.
- Salesmen can take credit bills and receive customer payments. Supplier payments are Admin / Co-admin only.

## 6. Barcode scanner

Any USB or Bluetooth scanner that works as a keyboard (almost all do) works out of the box. On **New sale** or **New purchase**, scan an item. It's matched by **Item code** and added to the bill, and scanning it again increases the quantity. A high beep means it was added; a low beep means it wasn't found.

- Even if you clicked somewhere else on the page, a fast scan is still caught.
- You can also type part of a name and pick the item from the list (useful for the products that have no item code).
- In a purchase, if a new item arrives, click **New product** and scan its barcode into the **Item code** box.
- On a phone, pair a Bluetooth scanner in keyboard (HID) mode.

## 7. Printing bills

After saving a sale, click **Print**. The bill is sized for 58/80 mm thermal printers and also prints fine on A4. Your shop name, address, and phone come from `VITE_SHOP_NAME`, `VITE_SHOP_ADDRESS`, and `VITE_SHOP_PHONE` in `.env`.

---

## 8. Free hosting

**Recommended: Cloudflare Pages (frontend) + Supabase Free (database).**

The app is a static site: after `npm run build` it's just files, and all the data lives in Supabase. So it doesn't need a server that can "sleep". Free hosts that run a server (Render, Railway, etc.) put apps to sleep, and the first open is slow. A static site on Cloudflare doesn't have that problem.

**Deploy to Cloudflare Pages**
1. Put this folder on GitHub (a private repo is fine). `.env` is git-ignored, so your keys won't be uploaded.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build command: `npm run build`. Output directory: `dist`.
4. **Environment variables**: add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SHOP_NAME`, `VITE_SHOP_ADDRESS`, `VITE_SHOP_PHONE`.
5. Deploy. You get `https://<name>.pages.dev`, and every push to GitHub redeploys. `public/_redirects` is already included so page refreshes work.
6. In Supabase → **Authentication → URL Configuration**, set **Site URL** to your pages.dev address.

(Vercel or Netlify also work. `vercel.json` is included.)

**Keep the free database from pausing.** Supabase pauses a free project after about a week with no activity. Normal daily shop use prevents this. For extra safety, move `supabase/keep-supabase-awake.yml` to `.github/workflows/keep-supabase-awake.yml` (create the folders), push to GitHub, and add repository secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`. It then pings the database every 2 days by itself. If a project ever does get paused, open it in Supabase and click **Restore**. The data is kept.

**Backups.** The free plan has no automatic backups. Once a week, use **Products → Export** and **Sales/Purchases → Excel**, or upgrade Supabase to Pro if the shop depends on it.

---

## Project layout

```
supabase/schema.sql     database tables, roles, security rules, sale/purchase functions
src/lib/                supabase client, auth/roles, product catalog cache, Excel import/export
src/components/         layout, scan box, bill lines, receipt, product & customer forms
src/pages/              Dashboard, NewSale, Sales, NewPurchase, Purchases, Products, Customers, Users
```
