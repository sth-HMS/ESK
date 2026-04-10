# ESK prototype

Keyranlegt Node.js prototype fyrir:

- nýskráningu og innskráningu
- admin / user hlutverk
- stofnun og vistun mála
- innlestur á Excel skráningartöflu
- vistaðar PDF teikningar
- PDF viðaukar/fylgiskjöl
- fyrstu drög að eignaskiptatexta
- OpenAI-studd AI textagerð með local prompt-skills
- formleg PDF forsíða með lógói og útgefandaupplýsingum

## Keyrsla

```powershell
node server.js
```

Opna svo `http://127.0.0.1:3000`.

## AI stillingar

Afritaðu `.env.example` yfir í `.env` og settu inn OpenAI lykil:

```powershell
Copy-Item .env.example .env
```

Síðan fyllir þú út:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REASONING_EFFORT=low
```

Þegar lykill er kominn inn birtist `Skrifa með AI` hnappurinn sem kallar á OpenAI Responses API.

## Athugið

- Fyrsti notandi sem skráir sig verður `admin`.
- Gögn vistast í `data/`.
- Upphlaðnar skrár vistast í `data/uploads/`.
- Excel innlestur er prototype-útgáfa sem les vinnublöð og forskoðun á efstu röðum úr `.xlsx`/`.xlsm`.
- PDF skjöl eru nú meðhöndluð sem fylgiskjöl/viðaukar sem tengjast málinu.
- AI er aukaval fyrir textabætur, en grunnflæðið er áfram Excel -> verkefni -> drög.
- `skills/` inniheldur staðbundnar prompt-reglur sem eru settar inn í AI textagerðina.
- PDF útflutningur notar staðbundið Microsoft Edge eða Google Chrome í headless mode til að rendera formfast skjal.
