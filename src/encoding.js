function repairText(value) {
  const text = String(value ?? "");
  let repaired = text;
  if (/[ÃÂÐÞ�]/.test(repaired)) {
    try {
      repaired = Buffer.from(repaired, "latin1").toString("utf8");
    } catch {
      repaired = text;
    }
  }
  const replacements = [
    ["Â·", "·"],
    ["mÂ²", "m²"],
    ["â€”", "—"],
    ["M�l", "Mál"],
    ["m�l", "mál"],
    ["m�ls", "máls"],
    ["M�n", "Mín"],
    ["Skr�", "Skrá"],
    ["Skr�ning", "Skráning"],
    ["Nafn �", "Nafn út"],
    ["Fors��", "Forsíð"],
    ["Fors�", "Forsí"],
    ["Innskr�ning", "Innskráning"],
    ["N�skráning", "Nýskráning"],
    ["lykilor�", "lykilorð"],
    ["Lykilor�", "Lykilorð"],
    ["a�", "að"],
    ["A�", "Að"],
    ["�", "ð"],
    ["s�", "sé"],
    ["S�", "Sé"],
    ["séreignir", "séreignir"],
    ["Sveitarf�lag", "Sveitarfélag"],
    ["Landeignan�mer", "Landeignanúmer"],
    ["Fasteignan�mer", "Fasteignanúmer"],
    ["Matshluti", "Matshluti"],
    ["Yfirl�sing", "Yfirlýsing"],
    ["L�sing", "Lýsing"],
    ["Yfirfer�", "Yfirferð"],
    ["sta�festing", "staðfesting"],
    ["Kva�ir", "Kvaðir"],
    ["r�ttindi", "réttindi"],
    ["rafmagnskostna�ur", "rafmagnskostnaður"],
    ["fylgiskj�l", "fylgiskjöl"],
    ["vi�aukar", "viðaukar"],
    ["vi�auki", "viðauki"],
    ["hla�i�", "hlaðið"],
    ["�eirra", "þeirra"],
    ["�eir", "þeir"],
    ["�inglýstum", "þinglýstum"],
    ["eigna sem �eir", "eigna sem þeir"],
    ["Nett�", "Nettó"],
    ["Holtag�rðum", "Holtagörðum"],
    ["l�ð", "lóð"],
    ["st�ðu", "stöðu"],
  ];
  for (const [from, to] of replacements) {
    repaired = repaired.split(from).join(to);
  }
  return repaired;
}

module.exports = {
  repairText,
};
