\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('app.current_account_id', :'account_id', true), set_config('app.current_user_id', :'owner_id', true), set_config('app.current_role', 'owner', true);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM users WHERE id = current_setting('app.current_user_id')::uuid AND account_id = current_setting('app.current_account_id')::uuid AND role = 'owner') THEN RAISE EXCEPTION 'Account/owner pair not verified under RLS'; END IF; END $$;
CREATE TEMP TABLE demo_ids (kind text, n int, id uuid, PRIMARY KEY(kind,n)) ON COMMIT DROP;
INSERT INTO demo_ids(kind,n,id)
SELECT k, n, (substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12))::uuid
FROM (SELECT k,n,md5('titan-field-demo-pilot-v1:'||current_setting('app.current_account_id')||':'||k||':'||n) h FROM (VALUES ('client',25),('property',35),('job',50),('wo',50),('visit',75)) types(k,amount) CROSS JOIN LATERAL generate_series(1,types.amount) n) x;
INSERT INTO clients(id,account_id,name,notes)
SELECT id,current_setting('app.current_account_id')::uuid,'[DEMO] Customer '||lpad(n::text,3,'0'),'Synthetic demonstration customer; no contact information' FROM demo_ids WHERE kind='client' ON CONFLICT (id) DO NOTHING;
INSERT INTO properties(id,account_id,client_id,name,address,city,state,zip,notes)
SELECT p.id,current_setting('app.current_account_id')::uuid,c.id,'[DEMO] Site '||lpad(p.n::text,3,'0'), '[DEMO] Fictional Site '||p.n||' (not a real street address)', 'Melbourne','VIC','3000','Synthetic site; no verified geolocation'
FROM demo_ids p JOIN demo_ids c ON c.kind='client' AND c.n=((p.n-1)%25)+1 WHERE p.kind='property' ON CONFLICT (id) DO NOTHING;
INSERT INTO jobs(id,account_id,client_id,property_id,title,description,status,priority,created_by,job_type)
SELECT j.id,current_setting('app.current_account_id')::uuid,c.id,p.id,'[DEMO] '||(ARRAY['Tap repair','Garden maintenance','Lighting inspection','Gutter service','Air conditioning check'])[((j.n-1)%5)+1]||' #'||j.n,'Synthetic test job — do not dispatch or invoice externally',
(ARRAY['draft','quoted','scheduled','in_progress','completed'])[((j.n-1)%5)+1],((j.n-1)%4)+1,current_setting('app.current_user_id')::uuid,'maintenance'
FROM demo_ids j JOIN demo_ids c ON c.kind='client' AND c.n=((j.n-1)%25)+1 JOIN demo_ids p ON p.kind='property' AND p.n=((j.n-1)%35)+1 WHERE j.kind='job' ON CONFLICT (id) DO NOTHING;
INSERT INTO work_orders(id,account_id,client_id,job_id,property_id,title,scope,status,created_by)
SELECT w.id,current_setting('app.current_account_id')::uuid,j.client_id,j.id,j.property_id,'[DEMO] Work order '||w.n,'Synthetic non-dispatchable demo work order','ready',current_setting('app.current_user_id')::uuid
FROM demo_ids w JOIN demo_ids ji ON ji.kind='job' AND ji.n=w.n JOIN jobs j ON j.id=ji.id WHERE w.kind='wo' ON CONFLICT (id) DO NOTHING;
INSERT INTO visits(id,account_id,job_id,work_order_id,assigned_user_id,status,scheduled_start,scheduled_end,tech_notes,visit_type)
SELECT v.id,current_setting('app.current_account_id')::uuid,j.id,w.id,NULL,'scheduled',
(now() + ((v.n-35)*interval '1 day') + interval '9 hours'),(now() + ((v.n-35)*interval '1 day') + interval '11 hours'), '[DEMO] Synthetic visit; do not dispatch','standard'
FROM demo_ids v JOIN demo_ids ji ON ji.kind='job' AND ji.n=((v.n-1)%50)+1 JOIN jobs j ON j.id=ji.id JOIN demo_ids wi ON wi.kind='wo' AND wi.n=((v.n-1)%50)+1 JOIN work_orders w ON w.id=wi.id WHERE v.kind='visit' ON CONFLICT (id) DO NOTHING;
SELECT 'clients' AS entity,count(*) AS demo_count FROM clients WHERE id IN (SELECT id FROM demo_ids WHERE kind='client')
UNION ALL SELECT 'properties',count(*) FROM properties WHERE id IN (SELECT id FROM demo_ids WHERE kind='property')
UNION ALL SELECT 'jobs',count(*) FROM jobs WHERE id IN (SELECT id FROM demo_ids WHERE kind='job')
UNION ALL SELECT 'work_orders',count(*) FROM work_orders WHERE id IN (SELECT id FROM demo_ids WHERE kind='wo')
UNION ALL SELECT 'visits',count(*) FROM visits WHERE id IN (SELECT id FROM demo_ids WHERE kind='visit');
\if :apply
COMMIT;
\echo 'APPLIED: demo pilot committed'
\else
ROLLBACK;
\echo 'DRY RUN: rolled back all changes'
\endif
