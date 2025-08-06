const Base = require('./BaseModel')
const OrganizationMember = require('./OrganizationMember');

class OrganizationInvitation extends Base {
    static tableName = 'org_invitations';

    /* Create an invite row and return it. */ 
    static async createInvite({organizationId, email, role = 'member', token, expiresAt}) {
        return this.insert({
            organization_id: organizationId, 
            email, 
            role, 
            token, 
            expires_at: expiresAt
        }, trx)
    };

    /* Lookup by token to ensure it hasn't expired.*/
    static async findValidByToken(token) {
        return this.table
        .where({token})
        .andWhere('expires_at', '>', knex.fn.now())
        .first();
    }

    /* Accept an invitation flow 
    1. Validate the email and token. 
    2. Add the user to the team.
    3. Delete invite.
    */
    static async accept({ token, userId, userEmail }, trx = this.table) {
        return trx.transaction(async (t) => {
          const invite = await this.findValidByToken(token);
          if (!invite) throw new Error('Invite invalid or expired');
          if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
            throw new Error('Invite email mismatch');
          }
    
          // add member
          await OrganizationMember.add({
            organizationId: invite.organization_id,
            userId,
            role: invite.role
          }, t);
    
          // remove invite to prevent reuse
          await t('org_invitations').where({ id: invite.id }).del();
    
          return invite;        // could return org or member row instead
        });
      }
}