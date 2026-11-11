import { randomUUID } from "node:crypto";
import { Pool } from "pg";

/** Disposable PostgreSQL fixture; every test owns accounts with random ids. */
export async function createIntakeMediaDbFixture() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for the integration suite");
  const pool = new Pool({ connectionString: url, max: 4 });
  const accountA = randomUUID(), accountB = randomUUID();
  const inviteA = randomUUID(), inviteB = randomUUID();
  const tokenA = randomUUID(), tokenB = randomUUID();
  const requestA = randomUUID(), requestB = randomUUID();
  try {
    await pool.query("INSERT INTO accounts(id,name) VALUES ($1,'photo-tx-A'),($2,'photo-tx-B')", [accountA, accountB]);
    await pool.query(
      `INSERT INTO booking_requests (id,account_id,name,service_description)
       VALUES ($1,$2,'Lead A','A request with an attached photograph'),
              ($3,$4,'Lead B','Another tenant request with a photograph')`,
      [requestA, accountA, requestB, accountB],
    );
    await pool.query(
      `INSERT INTO intake_invites(id,account_id,booking_request_id,token,lead_name,lead_email)
       VALUES ($1,$2,$3,$4,'Lead A','a@example.com'),
              ($5,$6,$7,$8,'Lead B','b@example.com')`,
      [inviteA, accountA, requestA, tokenA, inviteB, accountB, requestB, tokenB],
    );
  } catch(error) {
    await pool.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]).catch(()=>undefined);
    await pool.end();
    throw error;
  }
  async function insertMedia(accountId = accountA, inviteId = inviteA, bookingId: string|null = requestA) {
    const filename = randomUUID() + ".jpg";
    const {rows} = await pool.query<{id:string}>(
      `INSERT INTO intake_media(account_id,intake_invite_id,booking_request_id,filename,original_name,mime_type,size_bytes)
       VALUES($1,$2,$3,$4,'photo.jpg','image/jpeg',10) RETURNING id`,
      [accountId,inviteId,bookingId,filename],
    );
    return rows[0].id;
  }
  async function cleanup() {
    await pool.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await pool.end();
  }
  return {pool,accountA,accountB,inviteA,inviteB,tokenA,tokenB,requestA,requestB,insertMedia,cleanup};
}
