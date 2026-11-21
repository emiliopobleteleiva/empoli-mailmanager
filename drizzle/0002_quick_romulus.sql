CREATE TABLE `recurring_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`task_id` integer,
	`recipient` text NOT NULL,
	`status` text NOT NULL,
	`created` text NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE TABLE `recurring_series` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`assignee` text NOT NULL,
	`creator` text NOT NULL,
	`frequency` text NOT NULL,
	`first_due` text NOT NULL,
	`next_due` text NOT NULL,
	`setup_status` text DEFAULT 'pending' NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `series_id` text;