/** Strips characters unsafe for filenames, keeps alphanumeric, caps at 30 chars */
function toSafeFilePart(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 30);
}

/** HTML date input (YYYY-MM-DD) → DD.MM.YYYY */
function toGermanDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Derive the Description (column B) from form data */
function buildDescription({ category, nickname, carUsed, hotelName, rentalCompany, opponent, matchNum }) {
  switch (category) {
    case 'Gas':           return `Gas - ${carUsed} - ${nickname} - ${opponent} ${matchNum}`;
    case 'Accommodation': return `${hotelName} - ${nickname}`;
    case 'Car Rental':    return `${rentalCompany} - ${nickname}`;
    case 'Umpire':        return `Umpire - ${opponent} ${matchNum}`;
    default:              return `${category} - ${nickname}`;
  }
}

module.exports = { toSafeFilePart, toGermanDate, buildDescription };
