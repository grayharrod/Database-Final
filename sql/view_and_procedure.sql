-- sql/view_and_procedure.sql
-- The VIEW and STORED PROCEDURE for the Ben 10 database.
--
-- Two ways to run it:
--   node scripts/setup_sql.js            (reads this file and runs it)
--   or paste it into MySQL Workbench and run it there
--
-- Safe to run again: each object is dropped first, then recreated.

USE ben10;

DELIMITER $$

-- ---------------------------------------------------------------------------
-- VIEW v_alien_usage
-- One row per alien form: its species, power level, first episode, how many
-- episodes it shows up in and how many times it was used in total.
-- A view is a saved SELECT: you query it like a table, but it always reflects
-- the current data in the tables underneath.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_alien_usage $$

CREATE VIEW v_alien_usage AS
SELECT  af.alien_form_id,
        af.name                          AS alien,
        sp.name                          AS species,
        af.power_level,
        fe.title                         AS first_episode,
        COUNT(eaf.episode_id)            AS episodes_appeared,
        CAST(COALESCE(SUM(eaf.times_used), 0) AS UNSIGNED) AS total_uses
  FROM  Alien_Form af
LEFT JOIN Species sp             ON sp.species_id    = af.species_id
LEFT JOIN Episode fe             ON fe.episode_id    = af.first_episode_id
LEFT JOIN Episode_Alien_Form eaf ON eaf.alien_form_id = af.alien_form_id
GROUP BY af.alien_form_id, af.name, sp.name, af.power_level, fe.title $$

-- ---------------------------------------------------------------------------
-- STORED PROCEDURE sp_character_episodes(p_name)
-- Every episode a character appears in, with series, season, air date and
-- the role they had in it. p_name can be part of a name ('Kevin' matches
-- 'Kevin Levin (Classic)' and others).
-- A stored procedure is a named program saved inside MySQL that takes
-- parameters; you run it with CALL sp_character_episodes('Kevin');
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_character_episodes $$

CREATE PROCEDURE sp_character_episodes(IN p_name VARCHAR(100))
BEGIN
  SELECT  c.name            AS `character`,
          sr.title          AS series,
          sn.season_number  AS season,
          e.episode_number,
          e.title           AS episode,
          e.air_date,
          ec.role_type
    FROM  `Character` c
    JOIN  Episode_Character ec ON ec.character_id = c.character_id
    JOIN  Episode e            ON e.episode_id    = ec.episode_id
    JOIN  Season sn            ON sn.season_id    = e.season_id
    JOIN  Series sr            ON sr.series_id    = sn.series_id
   WHERE  c.name LIKE CONCAT('%', p_name, '%')
ORDER BY  c.name, e.air_date IS NULL, e.air_date, e.episode_id;
END $$

DELIMITER ;
