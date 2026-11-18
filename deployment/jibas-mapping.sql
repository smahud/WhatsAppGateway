-- Read-only mapping: creating this view does not forward or send messages.
-- Original JIBAS tables are unchanged. Select the configured gateway schema first.
CREATE OR REPLACE VIEW jibas_outbox_mapping AS
SELECT ID AS jibas_outbox_id,
       CASE
         WHEN LEFT(clean_number, 1) = '0' THEN CONCAT('62', SUBSTRING(clean_number, 2))
         WHEN LEFT(clean_number, 1) = '8' THEN CONCAT('62', clean_number)
         ELSE clean_number
       END AS wa_no,
       COALESCE(NULLIF(Text, ''), TextDecoded) AS wa_text,
       SendingDateTime AS scheduled_at,
       InsertIntoDB AS created_at,
       idsmsgeninfo,
       status AS jibas_status,
       MultiPart AS multipart
FROM (
  SELECT o.*, REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(DestinationNumber), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') AS clean_number
  FROM jbssms.outbox o
) AS source_sms;
