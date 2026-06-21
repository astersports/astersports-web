ALTER TABLE `studio_jobs` ADD `editType` varchar(16);
--> statement-breakpoint
UPDATE `studio_jobs` SET `editType` = CASE
  WHEN (`controls` LIKE '%"recolor":%"enabled":true%') + (`controls` LIKE '%"scale":%"enabled":true%') + (`controls` LIKE '%"density":%"enabled":true%') + (`controls` LIKE '%"remove":%"enabled":true%') > 1 THEN 'mixed'
  WHEN `controls` LIKE '%"recolor":%"enabled":true%' THEN 'recolor'
  WHEN `controls` LIKE '%"scale":%"enabled":true%' THEN 'scale'
  WHEN `controls` LIKE '%"density":%"enabled":true%' THEN 'density'
  WHEN `controls` LIKE '%"remove":%"enabled":true%' THEN 'remove'
  ELSE 'none'
END
WHERE `editType` IS NULL;