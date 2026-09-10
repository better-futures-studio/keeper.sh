ALTER TABLE "calendars" ALTER COLUMN "markEventsAsPrivate" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;