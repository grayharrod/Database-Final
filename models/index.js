const { DataTypes } = require('sequelize');
const sequelize = require('../db');

// ---------- Core entities ----------

const Series = sequelize.define(
  'Series',
  {
    series_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING(100), allowNull: false },
    release_year: { type: DataTypes.INTEGER },
    network: { type: DataTypes.STRING(50) },
  },
  { tableName: 'Series', timestamps: false }
);

const Season = sequelize.define(
  'Season',
  {
    season_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    series_id: { type: DataTypes.INTEGER, allowNull: false },
    season_number: { type: DataTypes.INTEGER, allowNull: false },
    year: { type: DataTypes.INTEGER },
  },
  { tableName: 'Season', timestamps: false }
);

const Episode = sequelize.define(
  'Episode',
  {
    episode_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    season_id: { type: DataTypes.INTEGER, allowNull: false },
    title: { type: DataTypes.STRING(150), allowNull: false },
    episode_number: { type: DataTypes.INTEGER, allowNull: false },
    air_date: { type: DataTypes.DATEONLY },
  },
  { tableName: 'Episode', timestamps: false }
);

const Location = sequelize.define(
  'Location',
  {
    location_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    type: { type: DataTypes.STRING(50) },
    galaxy: { type: DataTypes.STRING(50) },
  },
  { tableName: 'Location', timestamps: false }
);

const Species = sequelize.define(
  'Species',
  {
    species_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    homeworld_id: { type: DataTypes.INTEGER },
  },
  { tableName: 'Species', timestamps: false }
);

const Character = sequelize.define(
  'Character',
  {
    character_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    species_id: { type: DataTypes.INTEGER },
    gender: { type: DataTypes.STRING(20) },
    is_human: { type: DataTypes.BOOLEAN },
    first_episode_id: { type: DataTypes.INTEGER },
  },
  { tableName: 'Character', timestamps: false }
);

const AlienForm = sequelize.define(
  'AlienForm',
  {
    alien_form_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    species_id: { type: DataTypes.INTEGER },
    power_level: { type: DataTypes.INTEGER },
    first_episode_id: { type: DataTypes.INTEGER },
  },
  { tableName: 'Alien_Form', timestamps: false }
);

const Ability = sequelize.define(
  'Ability',
  {
    ability_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(100) },
  },
  { tableName: 'Ability', timestamps: false }
);

const Organization = sequelize.define(
  'Organization',
  {
    org_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    type: { type: DataTypes.STRING(50) },
    base_location_id: { type: DataTypes.INTEGER },
  },
  { tableName: 'Organization', timestamps: false }
);

const Device = sequelize.define(
  'Device',
  {
    device_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    owner_character_id: { type: DataTypes.INTEGER },
    description: { type: DataTypes.STRING(100) },
  },
  { tableName: 'Device', timestamps: false }
);

const VoiceActor = sequelize.define(
  'VoiceActor',
  {
    actor_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
  },
  { tableName: 'Voice_Actor', timestamps: false }
);

// ---------- Junction / through tables ----------

const EpisodeAlienForm = sequelize.define(
  'EpisodeAlienForm',
  {
    episode_id: { type: DataTypes.INTEGER, primaryKey: true },
    alien_form_id: { type: DataTypes.INTEGER, primaryKey: true },
    times_used: { type: DataTypes.INTEGER },
  },
  { tableName: 'Episode_Alien_Form', timestamps: false }
);

const EpisodeLocation = sequelize.define(
  'EpisodeLocation',
  {
    episode_id: { type: DataTypes.INTEGER, primaryKey: true },
    location_id: { type: DataTypes.INTEGER, primaryKey: true },
  },
  { tableName: 'Episode_Location', timestamps: false }
);

const EpisodeCharacter = sequelize.define(
  'EpisodeCharacter',
  {
    episode_id: { type: DataTypes.INTEGER, primaryKey: true },
    character_id: { type: DataTypes.INTEGER, primaryKey: true },
    role_type: { type: DataTypes.STRING(20) },
  },
  { tableName: 'Episode_Character', timestamps: false }
);

const AlienFormAbility = sequelize.define(
  'AlienFormAbility',
  {
    alien_form_id: { type: DataTypes.INTEGER, primaryKey: true },
    ability_id: { type: DataTypes.INTEGER, primaryKey: true },
  },
  { tableName: 'Alien_Form_Ability', timestamps: false }
);

const CharacterOrganization = sequelize.define(
  'CharacterOrganization',
  {
    character_id: { type: DataTypes.INTEGER, primaryKey: true },
    org_id: { type: DataTypes.INTEGER, primaryKey: true },
    rank: { type: DataTypes.STRING(50) },
    joined_season_id: { type: DataTypes.INTEGER },
  },
  { tableName: 'Character_Organization', timestamps: false }
);

const CharacterVoice = sequelize.define(
  'CharacterVoice',
  {
    character_id: { type: DataTypes.INTEGER, primaryKey: true },
    actor_id: { type: DataTypes.INTEGER, primaryKey: true },
    season_id: { type: DataTypes.INTEGER, primaryKey: true },
  },
  { tableName: 'Character_Voice', timestamps: false }
);

// ---------- Associations ----------

// Series 1—N Season
Series.hasMany(Season, { foreignKey: 'series_id', onDelete: 'CASCADE' });
Season.belongsTo(Series, { foreignKey: 'series_id' });

// Season 1—N Episode
Season.hasMany(Episode, { foreignKey: 'season_id', onDelete: 'CASCADE' });
Episode.belongsTo(Season, { foreignKey: 'season_id' });

// Location 1—N Species (homeworld)
Location.hasMany(Species, { foreignKey: 'homeworld_id', as: 'SpeciesHomeworld' });
Species.belongsTo(Location, { foreignKey: 'homeworld_id', as: 'Homeworld' });

// Location 1—N Organization (base)
Location.hasMany(Organization, { foreignKey: 'base_location_id', as: 'OrganizationsAtBase' });
Organization.belongsTo(Location, { foreignKey: 'base_location_id', as: 'BaseLocation' });

// Species 1—N Character
Species.hasMany(Character, { foreignKey: 'species_id' });
Character.belongsTo(Species, { foreignKey: 'species_id' });

// Species 1—N AlienForm
Species.hasMany(AlienForm, { foreignKey: 'species_id' });
AlienForm.belongsTo(Species, { foreignKey: 'species_id' });

// Episode 1—N Character (first appearance) — circular; keep nullable
Episode.hasMany(Character, { foreignKey: 'first_episode_id', as: 'CharactersDebuting' });
Character.belongsTo(Episode, { foreignKey: 'first_episode_id', as: 'FirstEpisode' });

// Episode 1—N AlienForm (first appearance) — circular; keep nullable
Episode.hasMany(AlienForm, { foreignKey: 'first_episode_id', as: 'AlienFormsDebuting' });
AlienForm.belongsTo(Episode, { foreignKey: 'first_episode_id', as: 'FirstEpisode' });

// Character 1—N Device
Character.hasMany(Device, { foreignKey: 'owner_character_id' });
Device.belongsTo(Character, { foreignKey: 'owner_character_id', as: 'Owner' });

// Episode N—M AlienForm (times_used)
Episode.belongsToMany(AlienForm, {
  through: EpisodeAlienForm,
  foreignKey: 'episode_id',
  otherKey: 'alien_form_id',
});
AlienForm.belongsToMany(Episode, {
  through: EpisodeAlienForm,
  foreignKey: 'alien_form_id',
  otherKey: 'episode_id',
});
EpisodeAlienForm.belongsTo(Episode, { foreignKey: 'episode_id' });
EpisodeAlienForm.belongsTo(AlienForm, { foreignKey: 'alien_form_id' });

// Episode N—M Location
Episode.belongsToMany(Location, {
  through: EpisodeLocation,
  foreignKey: 'episode_id',
  otherKey: 'location_id',
});
Location.belongsToMany(Episode, {
  through: EpisodeLocation,
  foreignKey: 'location_id',
  otherKey: 'episode_id',
});

// Episode N—M Character (role_type)
Episode.belongsToMany(Character, {
  through: EpisodeCharacter,
  foreignKey: 'episode_id',
  otherKey: 'character_id',
  as: 'AppearingCharacters',
});
Character.belongsToMany(Episode, {
  through: EpisodeCharacter,
  foreignKey: 'character_id',
  otherKey: 'episode_id',
  as: 'AppearingEpisodes',
});
EpisodeCharacter.belongsTo(Episode, { foreignKey: 'episode_id' });
EpisodeCharacter.belongsTo(Character, { foreignKey: 'character_id' });

// AlienForm N—M Ability
AlienForm.belongsToMany(Ability, {
  through: AlienFormAbility,
  foreignKey: 'alien_form_id',
  otherKey: 'ability_id',
});
Ability.belongsToMany(AlienForm, {
  through: AlienFormAbility,
  foreignKey: 'ability_id',
  otherKey: 'alien_form_id',
});

// Character N—M Organization (rank, joined_season_id)
Character.belongsToMany(Organization, {
  through: CharacterOrganization,
  foreignKey: 'character_id',
  otherKey: 'org_id',
});
Organization.belongsToMany(Character, {
  through: CharacterOrganization,
  foreignKey: 'org_id',
  otherKey: 'character_id',
});
CharacterOrganization.belongsTo(Character, { foreignKey: 'character_id' });
CharacterOrganization.belongsTo(Organization, { foreignKey: 'org_id' });
CharacterOrganization.belongsTo(Season, { foreignKey: 'joined_season_id', as: 'JoinedSeason' });
Season.hasMany(CharacterOrganization, { foreignKey: 'joined_season_id' });

// Character N—M VoiceActor per Season (composite PK)
Character.belongsToMany(VoiceActor, {
  through: CharacterVoice,
  foreignKey: 'character_id',
  otherKey: 'actor_id',
});
VoiceActor.belongsToMany(Character, {
  through: CharacterVoice,
  foreignKey: 'actor_id',
  otherKey: 'character_id',
});
CharacterVoice.belongsTo(Character, { foreignKey: 'character_id' });
CharacterVoice.belongsTo(VoiceActor, { foreignKey: 'actor_id' });
CharacterVoice.belongsTo(Season, { foreignKey: 'season_id' });
Season.hasMany(CharacterVoice, { foreignKey: 'season_id' });

module.exports = {
  sequelize,
  Series,
  Season,
  Episode,
  Location,
  Species,
  Character,
  AlienForm,
  Ability,
  Organization,
  Device,
  VoiceActor,
  EpisodeAlienForm,
  EpisodeLocation,
  EpisodeCharacter,
  AlienFormAbility,
  CharacterOrganization,
  CharacterVoice,
};
