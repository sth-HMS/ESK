# Render deploy

Þetta repo er undirbúið fyrir Render með [render.yaml](/C:/Forrit_throun/ESK/render.yaml).

## Blueprint deploy

1. Skráðu þig inn á [Render](https://render.com).
2. Veldu `New +` -> `Blueprint`.
3. Veldu GitHub repo-ið `sth-HMS/ESK`.
4. Render býr þá sjálft til:
   - web service
   - persistent disk
   - `HOST=0.0.0.0`
   - `DATA_DIR=/opt/render/project-data`

## Handvirk uppsetning

Ef þú vilt stofna service handvirkt:

- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `node server.js`
- Environment variables:
  - `HOST=0.0.0.0`
  - `DATA_DIR=/opt/render/project-data`
  - `OPENAI_API_KEY=...`
  - `OPENAI_MODEL=gpt-5.4-mini`
  - `OPENAI_REASONING_EFFORT=low`

## Mikilvægt

Persistent disk er mikilvægur. Án hans glatast:

- vistuð mál
- uploads
- sessions

Diskurinn á að vera mountaður á `/opt/render/project-data`.
