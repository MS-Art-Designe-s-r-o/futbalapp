-- Štruktúra nákladov (skupiny a položky) + prepojenie výdavkov
CREATE TABLE "CostGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CostGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CostGroup_name_key" ON "CostGroup"("name");

CREATE TABLE "CostItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hasKinds" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CostItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CostItem_groupId_name_key" ON "CostItem"("groupId", "name");
ALTER TABLE "CostItem" ADD CONSTRAINT "CostItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CostGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD COLUMN "costItemId" TEXT, ADD COLUMN "kind" TEXT, ADD COLUMN "period" TEXT, ADD COLUMN "matchedBy" TEXT;
CREATE INDEX "Expense_costItemId_idx" ON "Expense"("costItemId");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_costItemId_fkey" FOREIGN KEY ("costItemId") REFERENCES "CostItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "CostGroup" ("id","name","sortOrder") VALUES ('c'||md5('Tribúna'),'Tribúna',1) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "CostGroup" ("id","name","sortOrder") VALUES ('c'||md5('Trávnik a telocvične'),'Trávnik a telocvične',2) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Tribúna/Plyn'),"id",'Plyn',1,false FROM "CostGroup" WHERE "name"='Tribúna' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Tribúna/Voda'),"id",'Voda',2,false FROM "CostGroup" WHERE "name"='Tribúna' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Tribúna/Elektrika'),"id",'Elektrika',3,false FROM "CostGroup" WHERE "name"='Tribúna' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Tribúna/Internet'),"id",'Internet',4,false FROM "CostGroup" WHERE "name"='Tribúna' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Tribúna/PHM'),"id",'PHM',5,false FROM "CostGroup" WHERE "name"='Tribúna' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Tribúna/Opravy pracovného náradia'),"id",'Opravy pracovného náradia',6,false FROM "CostGroup" WHERE "name"='Tribúna' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Tribúna/Spotrebný materiál'),"id",'Spotrebný materiál',7,false FROM "CostGroup" WHERE "name"='Tribúna' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Trávnik a telocvične/Telocvičňa Poľná malá'),"id",'Telocvičňa Poľná malá',1,true FROM "CostGroup" WHERE "name"='Trávnik a telocvične' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Trávnik a telocvične/Telocvičňa Poľná veľká'),"id",'Telocvičňa Poľná veľká',2,true FROM "CostGroup" WHERE "name"='Trávnik a telocvične' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Trávnik a telocvične/Telocvičňa Charkovská malá'),"id",'Telocvičňa Charkovská malá',3,true FROM "CostGroup" WHERE "name"='Trávnik a telocvične' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Trávnik a telocvične/Telocvičňa Charkovská veľká'),"id",'Telocvičňa Charkovská veľká',4,true FROM "CostGroup" WHERE "name"='Trávnik a telocvične' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Trávnik a telocvične/Tenisová hala KNV'),"id",'Tenisová hala KNV',5,true FROM "CostGroup" WHERE "name"='Trávnik a telocvične' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Trávnik a telocvične/Hlavný trávnik Košická Nová Ves'),"id",'Hlavný trávnik Košická Nová Ves',6,true FROM "CostGroup" WHERE "name"='Trávnik a telocvične' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Trávnik a telocvične/Pooraný trávnik malý Košická Nová Ves'),"id",'Pooraný trávnik malý Košická Nová Ves',7,true FROM "CostGroup" WHERE "name"='Trávnik a telocvične' ON CONFLICT ("groupId","name") DO NOTHING;
INSERT INTO "CostItem" ("id","groupId","name","sortOrder","hasKinds") SELECT 'c'||md5('Trávnik a telocvične/Krosnianska 2 Umelý trávnik'),"id",'Krosnianska 2 Umelý trávnik',8,true FROM "CostGroup" WHERE "name"='Trávnik a telocvične' ON CONFLICT ("groupId","name") DO NOTHING;
