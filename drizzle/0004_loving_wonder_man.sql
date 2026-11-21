CREATE TABLE `recurring_history` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`task_id` integer NOT NULL,
	`previous_due` text NOT NULL,
	`next_due` text NOT NULL,
	`previous_status` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_history_series_next_unique` ON `recurring_history` (`series_id`,`next_due`);--> statement-breakpoint
DROP INDEX `tasks_series_due_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_one_per_series` ON `tasks` (`series_id`);