const Base = require('./BaseModel');
const OrganizationMember = require('./OrganizationMember');
const Team = require('./Team');

class TeamMember extends Base {
    static tableName = 'organizations_members';

    /* CRUD Helper functions */
    static async add({teamId, userId, role = 'member'}) {
        return this.insert({team_id: teamId, user_id: userId, role});
    }
    static async remove({teamId, userId}) {
        return this.where({team_id: teamId, user_id: userId}).del();
    }
    static async setRole({teamId, userId, role}) {
        return this.updateComposite({team_id:  teamId, user_id: userId}, {role});
    }
    /* Utility functions */ 
    static async membersOfTeam(teamId) {
        return this.table
        .select('users.id', 'users.email', 'team_members.role', 'joined_at')
        .join('users','user.id','team_members.user_id')
        .where('team_id', teamId)
        .orderBy('joined_at','asc');
    }
    static async teamsForUser(userId) {
        return this.table
        .select('teams.*', 'team_members.role')
        .join('teams','teams.id','team_members.team_id')
        .where('team_members.user_id', userId)
    }

    static async isOwner (teamId, userId) {
        const row = await this.table
        .where({team_id: teamId, user_id: userId, role: 'owner'})
        .first();
        return !!row;
    }
    // Any user that belongs to an org can join any of the teams. 
    // Stretch Feature; add a team join policy option to limit the users that can join. 
    static async join({teamId, userId}, trx=this.table) {
        return trx.transaction(async t => {

            // Find the team to know it's org. 
            const team = await Team.findById(teamId);
            if(!team) throw new Error('Team Not Found');

            // Ensure the user already belongs to the org. 
            const orgMember = await OrganizationMember.findOne({
                    organization_id:team.organization_id, 
                    user_id: userId
                })
            if(!orgMember) throw new Error('You must join the organisation first!');


            // Insert Membership 
            return this.insert({
                team_id: teamId, 
                user_id: userId, 
                role: 'member'
            }, t);
        })
    }

}

module.exports = TeamMember