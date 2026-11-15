-- ==========================================================
-- 1. TABLE: AUTORESPON
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE autorespon CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE autorespon (
  profil  NUMBER(19) DEFAULT NULL,
  keyword VARCHAR2(100) NOT NULL,
  answer  CLOB, -- ✅ Oracle pakai CLOB untuk teks sangat panjang
  logic   VARCHAR2(1) DEFAULT NULL,
  CONSTRAINT pk_autorespon PRIMARY KEY (keyword)
);

-- ==========================================================
-- 2. TABLE: GRAB
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE grab CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE grab (
  profil  NUMBER(10) DEFAULT NULL,
  grup    VARCHAR2(50) DEFAULT NULL,
  contact VARCHAR2(50) DEFAULT NULL,
  nama    VARCHAR2(50) DEFAULT NULL
);

-- ==========================================================
-- 3. TABLE: GRAB_TMP
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE grab_tmp CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE grab_tmp (
  profil  NUMBER(10) NOT NULL,
  contact VARCHAR2(50) NOT NULL,
  nama    VARCHAR2(50) DEFAULT NULL
);

-- ==========================================================
-- 4. TABLE: INBOX
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE inbox CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE inbox_seq'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE inbox (
  id       NUMBER(19) NOT NULL,
  wa_no    VARCHAR2(200) NOT NULL,
  sub_no   VARCHAR2(200) DEFAULT NULL,
  wa_text  VARCHAR2(2000) NOT NULL,
  wa_time  TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- ✅ Oracle pakai TIMESTAMP
  status   VARCHAR2(5) DEFAULT NULL,
  CONSTRAINT pk_inbox PRIMARY KEY (id)
);

CREATE SEQUENCE inbox_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER inbox_seq_tr
BEFORE INSERT ON inbox FOR EACH ROW
WHEN (NEW.id IS NULL)
BEGIN
  SELECT inbox_seq.NEXTVAL INTO :NEW.id FROM DUAL;
END;
/

-- ==========================================================
-- 5. TABLE: MULTI
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE multi CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE multi_seq'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE multi (
  id         NUMBER(19) NOT NULL,
  tipe       VARCHAR2(1) DEFAULT NULL,
  profil     VARCHAR2(20) DEFAULT NULL,
  wa_mode    NUMBER(10) DEFAULT NULL,
  wa_no      VARCHAR2(200) NOT NULL,
  sub_no     VARCHAR2(200) DEFAULT NULL,
  wa_text    VARCHAR2(2000) NOT NULL,
  wa_media   VARCHAR2(500) DEFAULT NULL,
  wa_file    VARCHAR2(500) DEFAULT NULL,
  wa_time    TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  id_outbox  NUMBER(19) DEFAULT NULL,
  status     VARCHAR2(20) DEFAULT NULL,
  CONSTRAINT pk_multi PRIMARY KEY (id)
);

CREATE SEQUENCE multi_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER multi_seq_tr
BEFORE INSERT ON multi FOR EACH ROW
WHEN (NEW.id IS NULL)
BEGIN
  SELECT multi_seq.NEXTVAL INTO :NEW.id FROM DUAL;
END;
/

-- ==========================================================
-- 6. TABLE: OUTBOX
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE outbox CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE outbox_seq'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE outbox (
  id        NUMBER(19) NOT NULL,
  wa_mode   NUMBER(10) DEFAULT NULL,
  wa_no     VARCHAR2(200) NOT NULL,
  wa_text   VARCHAR2(2000) NOT NULL,
  wa_media  VARCHAR2(500) DEFAULT NULL,
  wa_file   VARCHAR2(500) DEFAULT NULL,
  wa_time   TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_outbox PRIMARY KEY (id)
);

CREATE SEQUENCE outbox_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER outbox_seq_tr
BEFORE INSERT ON outbox FOR EACH ROW
WHEN (NEW.id IS NULL)
BEGIN
  SELECT outbox_seq.NEXTVAL INTO :NEW.id FROM DUAL;
END;
/

-- ==========================================================
-- 7. TABLE: SENT
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE sent CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE sent (
  id        NUMBER(19) NOT NULL,
  wa_mode   NUMBER(10) DEFAULT NULL,
  wa_no     VARCHAR2(200) NOT NULL,
  wa_text   VARCHAR2(2000) NOT NULL,
  wa_media  VARCHAR2(500) DEFAULT NULL,
  wa_file   VARCHAR2(500) DEFAULT NULL,
  wa_time   TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  status    VARCHAR2(5) DEFAULT NULL,
  CONSTRAINT pk_sent PRIMARY KEY (id, wa_time)
);

-- ==========================================================
-- 8. TABLE: TESBOT
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE tesbot CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE tesbot (
  kode VARCHAR2(10) DEFAULT NULL,
  nama VARCHAR2(50) DEFAULT NULL
);

-- ==========================================================
-- 9. TABLE: TMP
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE tmp CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE tmp (
  tmp_cd  VARCHAR2(50) NOT NULL,
  tmp_val VARCHAR2(50) DEFAULT NULL,
  CONSTRAINT pk_tmp PRIMARY KEY (tmp_cd)
);

-- ==========================================================
-- 10. TABLE: WEB_USER
-- ==========================================================
BEGIN EXECUTE IMMEDIATE 'DROP TABLE web_user CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE web_user_seq'; EXCEPTION WHEN OTHERS THEN NULL; END;
/
CREATE TABLE web_user (
  id            NUMBER(19) NOT NULL,
  wa_user       VARCHAR2(100) NOT NULL,
  wa_no         VARCHAR2(30) NOT NULL,
  email         VARCHAR2(100) NOT NULL,
  status        VARCHAR2(1) DEFAULT 'Y',
  password      VARCHAR2(20) DEFAULT NULL,
  create_dt     TIMESTAMP(0) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_login    TIMESTAMP(0) DEFAULT NULL,
  qr            VARCHAR2(500) DEFAULT NULL,
  bot_mode      VARCHAR2(1) DEFAULT NULL,
  bot_url       VARCHAR2(500) DEFAULT NULL,
  disable_read  VARCHAR2(1) DEFAULT 'N',
  CONSTRAINT pk_web_user PRIMARY KEY (id)
);

CREATE SEQUENCE web_user_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE TRIGGER web_user_seq_tr
BEFORE INSERT ON web_user FOR EACH ROW
WHEN (NEW.id IS NULL)
BEGIN
  SELECT web_user_seq.NEXTVAL INTO :NEW.id FROM DUAL;
END;
/