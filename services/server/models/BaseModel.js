const knex = require('../db/knex');

class BaseModel {

 // Each subclass must define a static table name.
    static get table() {
        return knex(this.tableName);
    }

 // Finds a row by id.
    static async findById(id) {
        return this.table.where({ id }).first(); 
    }

 // Finds a row based on a criteria obj. 
    static async findOne(where) {
        return this.table.where(where).first();
    }

 // Retrieves a array of rows. 
    static async findAll(where = {}) {
        return this.table.where(where);
    }

 // Inserts the attributes into the table, returns row obj.
    static async insert(attrs) {
        return this.table.insert(attrs).returning('*').then(r=>r[0]);
    }

 // Updates the row and returns the row obj.
 static async update(id, patch) {
    return this.table.where({ id }).update(patch).returning('*').then(r=>r[0]);
 }
 // A Composite key-helper function. 
 static async updateComposite(where,patch) {
    return this.table.where(where).update(patch).returning('*').then(r=>r[0]);
 }
}

module.exports = BaseModel;