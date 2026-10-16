import { db } from './db';
import type { User } from './auth';
import type { Portfolio } from './portfolio-model';
// Authorize once in the query; never include credentials, raw provider errors or audit details.
// Separate grouped CTEs prevent account/campaign/job joins from multiplying totals.
export async function portfolioOverview(user:User):Promise<Portfolio>{
 const result=await db.query(`WITH permitted AS MATERIALIZED (
   SELECT c.id,c.name FROM clients c WHERE $1::boolean OR EXISTS (
     SELECT 1 FROM client_members m WHERE m.client_id=c.id AND m.user_id=$2::uuid)
 ), account_stats AS (
   SELECT a.client_id,count(*)::int AS total,
     count(*) FILTER(WHERE a.available AND c.status='connected')::int AS connected,
     count(*) FILTER(WHERE NOT a.available OR c.status<>'connected' OR c.import_status='error')::int AS issues,
     array_agg(DISTINCT a.platform ORDER BY a.platform) AS platforms
   FROM ad_accounts a JOIN permitted p ON p.id=a.client_id JOIN connections c ON c.id=a.connection_id GROUP BY a.client_id
 ), campaign_stats AS (
   SELECT c.client_id,count(*)::int AS total,
     count(*) FILTER(WHERE c.status='active')::int AS active,
     count(*) FILTER(WHERE c.status IN ('proposed','paused'))::int AS reviews,
     count(*) FILTER(WHERE c.status='approved')::int AS approved,
     count(*) FILTER(WHERE c.status='draft')::int AS drafts,
     count(*) FILTER(WHERE c.status='error' OR EXISTS(SELECT 1 FROM external_objects o WHERE o.campaign_id=c.id AND o.version=c.version AND o.kind='ad' AND o.delivery_status='REJECTED'))::int AS errors
   FROM campaigns c JOIN permitted p ON p.id=c.client_id GROUP BY c.client_id
 ), job_stats AS (
   SELECT j.client_id,count(*)::int AS failed FROM jobs j JOIN permitted p ON p.id=j.client_id
   LEFT JOIN campaigns c ON c.id=j.campaign_id
   WHERE j.status='failed' AND (j.campaign_id IS NULL OR j.version=c.version) GROUP BY j.client_id
 ), members AS (
   SELECT m.client_id,array_agg(DISTINCT u.name ORDER BY u.name) AS names FROM client_members m
   JOIN permitted p ON p.id=m.client_id JOIN users u ON u.id=m.user_id WHERE NOT u.disabled GROUP BY m.client_id
 ), recent AS (
   SELECT a.id::text AS id,a.client_id AS "clientId",p.name AS "clientName",a.action,
     coalesce(u.name,'Sistema') AS "userName",a.created_at AS "createdAt"
   FROM audit_log a JOIN permitted p ON p.id=a.client_id LEFT JOIN users u ON u.id=a.user_id
   ORDER BY a.created_at DESC,a.id DESC LIMIT 50
 ), rows AS (
   SELECT p.id,p.name,coalesce(a.platforms,ARRAY[]::text[]) AS platforms,
     coalesce(a.total,0) AS "accountCount",coalesce(a.connected,0) AS "connectedAccounts",coalesce(a.issues,0) AS "connectionIssues",
     coalesce(j.failed,0) AS "failedJobs",coalesce(c.errors,0) AS "errorCampaigns",coalesce(c.reviews,0) AS "reviewCount",
     coalesce(c.active,0) AS "activeCampaigns",coalesce(c.total,0) AS "campaignCount",coalesce(c.approved,0) AS "approvedCount",
     coalesce(c.drafts,0) AS "draftCount",coalesce(m.names,ARRAY[]::text[]) AS assignees
   FROM permitted p LEFT JOIN account_stats a ON a.client_id=p.id LEFT JOIN campaign_stats c ON c.client_id=p.id
   LEFT JOIN job_stats j ON j.client_id=p.id LEFT JOIN members m ON m.client_id=p.id
 ) SELECT coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY lower(r.name),r.id) FROM rows r),'[]'::jsonb) AS clients,
 coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."createdAt" DESC,a.id::bigint DESC) FROM recent a),'[]'::jsonb) AS activity,
 now() AS "updatedAt"`,[user.role==='admin',user.id]);
 return result.rows[0];
}
