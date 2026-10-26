CREATE TABLE `meal_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`draft_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`shopping_list_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meal_plans_user_updated` ON `meal_plans` (`user_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `shopping_lists` ADD `fulfillment_json` text;