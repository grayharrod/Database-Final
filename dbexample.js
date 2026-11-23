import "dotenv/config";
import { DataSource, EntitySchema, In } from "typeorm";

const Company = new EntitySchema({
  name: "Company",
  tableName: "companies",
  columns: {
    id: { type: "int", primary: true, generated: "increment" },
    name: { type: "varchar", length: 50 },
    specialty: { type: "varchar", length: 50 },
    bestMachine: { name: "best_machine", type: "varchar", length: 50, nullable: true },
  },
  uniques: [{ name: "uq_companies_name", columns: ["name"] }],
  relations: {
    machines: { type: "one-to-many", target: "Machine", inverseSide: "company" },
  },
});

const Machine = new EntitySchema({
  name: "Machine",
  tableName: "machines",
  columns: {
    id: { type: "int", primary: true, generated: "increment" },
    name: { type: "varchar", length: 50 },
    bodyPart: { name: "body_part", type: "varchar", length: 30 },
  },
  relations: {
    company: {
      type: "many-to-one",
      target: "Company",
      inverseSide: "machines",
      nullable: false,
      onDelete: "CASCADE",
      joinColumn: { name: "company_id", foreignKeyConstraintName: "fk_machines_company_id" },
    },
  },
});

const db = new DataSource({
  type: "mysql",
  host: process.env.DB_HOST ?? "localhost",
  username: process.env.DB_USER,
  password: process.env.DB_PW,
  database: process.env.DB_NAME,
  synchronize: true,
  entities: [Company, Machine],
});

const companies = db.getRepository(Company);
const machines = db.getRepository(Machine);

async function printCatalog(title) {
  const rows = await machines.find({
    relations: { company: true },
    order: { company: { name: "ASC" }, name: "ASC" },
  });
  console.log(`\n${title}`);
  console.table(
    rows.map((m) => ({
      company: m.company.name,
      specialty: m.company.specialty,
      machine: m.name,
      bodyPart: m.bodyPart,
    }))
  );
}

async function createRows() {
  await companies.delete({ name: In(["Atlantis", "MagaMass"]) });

  const atlantis = await companies.save({
    name: "Atlantis",
    specialty: "Modern Machines",
    bestMachine: "Pec Dec",
  });
  const magaMass = await companies.save({
    name: "MagaMass",
    specialty: "Smooth Rails",
    bestMachine: "Row Machine",
  });
  await machines.save([
    { name: "Pec Dec", bodyPart: "Chest", company: atlantis },
    { name: "T-Bar Row", bodyPart: "Upper Back", company: atlantis },
    { name: "MagaMass Row", bodyPart: "Upper Back", company: magaMass },
  ]);
  await printCatalog("After CREATE:");
}

async function readRows() {
  const allCompanies = await companies.find({ order: { id: "ASC" } });
  console.log("\nAll companies:");
  console.table(allCompanies);

  const allMachines = await machines.find({
    loadRelationIds: true,
    order: { id: "ASC" },
  });
  console.log("\nAll machines:");
  console.table(
    allMachines.map((m) => ({
      id: m.id,
      name: m.name,
      bodyPart: m.bodyPart,
      companyId: m.company,
    }))
  );
}

async function updateRows() {
  await companies.update({ name: "MagaMass" }, { specialty: "Plate-Loaded Machines" });
  await machines.update({ name: "T-Bar Row" }, { bodyPart: "Middle Back" });
  await printCatalog("After UPDATE:");
}

async function deleteRows() {
  await machines.delete({ name: "Pec Dec" });
  await companies.delete({ name: "Atlantis" });
  await printCatalog("After deletion");
}

const steps = { create: createRows, read: readRows, update: updateRows, delete: deleteRows };
const step = steps[process.argv[2]];

try {
  await db.initialize();
  console.log("Tables ready: companies, machines");

  if (step) await step();
  else console.log("Usage: node orm_test.js <create | read | update | delete>");
} catch (err) {
  console.error("ORM error:", err);
} finally {
  if (db.isInitialized) await db.destroy();
}
