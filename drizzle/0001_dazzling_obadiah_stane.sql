CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`uploader` text NOT NULL,
	`created` text NOT NULL
);
