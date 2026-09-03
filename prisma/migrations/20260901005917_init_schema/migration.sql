-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "role" VARCHAR(50) NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_states" (
    "id" SERIAL NOT NULL,
    "state" VARCHAR(255) NOT NULL,
    "nonce" VARCHAR(255) NOT NULL,
    "code_verifier" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "author" VARCHAR(200) NOT NULL,
    "accession_number" VARCHAR(60) NOT NULL,
    "isbn" VARCHAR(40),
    "publisher" VARCHAR(200),
    "publication_year" INTEGER,
    "category" VARCHAR(100),
    "total_copies" INTEGER NOT NULL,
    "available_copies" INTEGER NOT NULL,
    "cover_image_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borrow_transactions" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "book_id" INTEGER NOT NULL,
    "borrow_date" TIMESTAMPTZ NOT NULL,
    "due_date" TIMESTAMPTZ NOT NULL,
    "return_date" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL,
    "fine_amount" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "borrow_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" SERIAL NOT NULL,
    "auth_user_id" VARCHAR(120),
    "email" VARCHAR(200) NOT NULL,
    "username" VARCHAR(100),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "matric_number" VARCHAR(40),
    "department" VARCHAR(150),
    "level" VARCHAR(20),
    "role" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oidc_states_state_key" ON "oidc_states"("state");

-- CreateIndex
CREATE INDEX "borrow_transactions_member_id_idx" ON "borrow_transactions"("member_id");

-- CreateIndex
CREATE INDEX "borrow_transactions_book_id_idx" ON "borrow_transactions"("book_id");

-- CreateIndex
CREATE INDEX "members_auth_user_id_idx" ON "members"("auth_user_id");
