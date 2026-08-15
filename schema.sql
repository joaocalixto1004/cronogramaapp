-- Log de eventos do Ritmo.
--
-- Só existem inserções: um evento é um fato que aconteceu e não se desfaz.
-- É isso que permite que dois aparelhos trabalhem offline sem se sobrescrever.

CREATE TABLE IF NOT EXISTS eventos (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,  -- cursor de sincronização
  id      TEXT    NOT NULL UNIQUE,            -- uuid do cliente; torna o reenvio idempotente
  tipo    TEXT    NOT NULL,                   -- estudo | tema+ | tema- | prova
  payload TEXT    NOT NULL,                   -- JSON com os campos do evento
  ts      TEXT    NOT NULL                    -- quando aconteceu, ISO 8601
);
