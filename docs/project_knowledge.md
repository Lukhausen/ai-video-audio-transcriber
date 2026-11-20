# Project knowledge

- Support Groq, OpenAI, and Google for transcription and transcript transformation; Alibaba models and their temporary-upload infrastructure are no longer supported.
- Keep model choices current using official provider documentation; automatically select the strongest suitable model per provider and task when no valid explicit choice is saved, and preserve supported user selections.

- Google transcription uses `gemini-3.5-transcribe` as its default; Google provider selection also supports transcript transformations using current Gemini text models.
- Default to Google for first-time visitors and show the provider switch in Google, Groq, OpenAI order; preserve valid saved provider choices.
- When the selected provider has no saved API key, show a link icon beside its API-key label that opens that provider's key-creation page in a new tab.
- Show the saved recording duration beside “Recording recovered”, using the recorder's existing minutes-and-seconds format.

- Place timestamps and speaker-label switches beside Download transcripts and Clear transcribed files; collect supported metadata once, then update displayed, copied, and downloaded text locally without repeating transcription.
- Show timestamp and speaker switches only in the recent-transcript top bar; they also update expanded transcripts without collapsing them.
- Hide each transcript output switch when none of the displayed transcripts has matching metadata; show only the available timestamp and speaker controls instead of disabled controls.
- Deploy the website automatically when changes are pushed to `prod`, using the dedicated Hetzner FTP account; other branches do not publish the site.
- Keep recovered audio until valid replacement audio is saved, retain completed chunks across pause and retry, and export every completed transcript even when source basenames collide. Report missing or damaged audio explicitly and keep completed results visible when another file fails.
- Check the selected provider directly when the page opens or reopens and before sending audio. Use free read-only metadata requests and show connection failures beside the provider controls.
- Background transcription stays browser-only. Save started jobs and completed parts locally, process prepared audio in a service worker where available, and require an explicit retry when an interrupted provider request has an unknown outcome.
- On the first attempt and on every explicit file Retry, run FFmpeg on the original to create compressed MP3 for upload. Retain completed parts whose chunk boundaries still match and reuse saved audio when resuming from a pause.
- Opening or reloading the page must never trigger a clipboard write from a restored transcript or automatically resumed job. Auto-copy applies only to eligible transcriptions started on the current page.
