# Project knowledge

- Support Groq, OpenAI, and Google for transcription and transcript transformation; Alibaba models and their temporary-upload infrastructure are no longer supported.
- Keep model choices current using official provider documentation; automatically select the strongest suitable model per provider and task when no valid explicit choice is saved, and preserve supported user selections.

- Google transcription uses `gemini-3.5-transcribe` as its default; Google provider selection also supports transcript transformations using current Gemini text models.
- Default to Google for first-time visitors and show the provider switch in Google, Groq, OpenAI order; preserve valid saved provider choices.

- Place timestamps and speaker-label switches beside Download transcripts and Clear transcribed files; collect supported metadata once, then update displayed, copied, and downloaded text locally without repeating transcription.
- Show timestamp and speaker switches only in the recent-transcript top bar; they also update expanded transcripts without collapsing them.
- Deploy the website automatically when changes are pushed to `prod`, using the dedicated Hetzner FTP account; other branches do not publish the site.
