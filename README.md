# Edlink Automate

An automated pipeline to extract and manage academic materials from the Edlink Learning Management System (LMS). 

## Overview
This project automates the repetitive tasks of checking for new course materials on Edlink. Instead of manually downloading files and checking for assignments, this pipeline runs automatically in the background, organizes the materials in Google Drive, and sends a Telegram notification summarizing what needs to be done.

### Features
* **Automated Scraping**: Uses Playwright to navigate Edlink and find new (un-liked) posts.
* **Auto-Engagement**: Automatically "Likes" posts (to mark them as processed) and comments "terima kasih" (thank you) on the professor's post.
* **File Management**: Downloads attachments (PDF, PPTX, DOCX) and saves YouTube video URLs without downloading the heavy video files.
* **AI Classification**: Uses the Groq API (Qwen model) to analyze the professor's notes to classify the session as `STANDARD` (reading/watching) or `ACTION` (quiz, assignment, deadline).
* **Google Drive Sync**: Uploads all downloaded files and a generated `header.txt` summary to a structured folder in Google Drive.
* **Telegram Notifications**: Sends an alert to your phone with the course name, topic, Google Drive link, and clearly flags if immediate action is required.

## Technology Stack
* **Runtime**: Node.js & TypeScript
* **Automation**: Playwright
* **AI**: Groq API (Qwen model)
* **Storage**: Google Drive API
* **Notifications**: Telegram Bot API
* **Deployment**: Docker, Google Cloud Run, and Cloud Scheduler

## How it Works
1. **Extraction**: Logs into Edlink, scrolls the timeline, and finds any posts that haven't been processed yet.
2. **Processing**: Downloads files, extracts video URLs, and asks Groq if the text implies homework. It then automatically likes and comments on the post.
3. **Storage & Notification**: Bundles the session data into a folder, uploads it to Google Drive, and pings you on Telegram with the results.

## Setup & Deployment
This project is containerized using Docker and designed to run as a serverless Job on Google Cloud Run, triggered daily via Google Cloud Scheduler. 

Sensitive configurations (like passwords, tokens, and API keys) are managed securely through environment variables or Google Secret Manager, and are explicitly ignored from version control using `.gitignore` and `.dockerignore`.

---
*Note: This project is intended to streamline the collection of study materials so that the user can manually study them or summarize them using AI chat tools.*
