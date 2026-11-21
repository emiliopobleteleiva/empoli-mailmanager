CREATE TABLE `pilot_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` integer NOT NULL,
	`recipient` text NOT NULL,
	`status` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`provider_id` text
);
