const Team = require('../models/Team');
const Organization = require('../models/Organization');

exports.createTeam = async (req, res) => {
  try {
    const { name, organizationId } = req.body;
    
    if (!name || !organizationId) {
      return res.status(400).json({ message: 'Team name and organization ID are required' });
    }

    // Check if user is a member of the organization
    const orgMembers = await Organization.getMembers({ organizationId });
    const isMember = orgMembers.some(member => member.user_id === req.user.id);
    
    if (!isMember) {
      return res.status(403).json({ message: 'You must be a member of the organization to create a team' });
    }

    // Create team with current user as owner
    const team = await Team.create({
      organizationId,
      name,
      createBy: req.user.id
    });

    res.status(201).json({
      message: 'Team created successfully',
      team: team
    });
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.listByOrg = async (req, res) => {
  try {
    const { orgId } = req.params;
    
    // Check if user is a member of the organization
    const orgMembers = await Organization.getMembers({ organizationId: orgId });
    const isMember = orgMembers.some(member => member.user_id === req.user.id);
    
    if (!isMember) {
      return res.status(403).json({ message: 'You must be a member of the organization to view teams' });
    }

    const teams = await Team.listByOrg(orgId);
    
    res.json({
      teams
    });
  } catch (error) {
    console.error('Error listing teams:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.addMember = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId, role } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Check if the current user is the team owner
    const isOwner = await Team.isOwner({ teamId, userId: req.user.id });
    if (!isOwner) {
      return res.status(403).json({ message: 'Only team owners can add members' });
    }

    // Add member to team
    await Team.addMember({
      teamId,
      userId,
      role: role || 'member'
    });

    res.json({ message: 'Member added successfully' });
  } catch (error) {
    console.error('Error adding team member:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.joinOpenTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    
    // Add current user to the team
    await Team.addMember({
      teamId,
      userId: req.user.id,
      role: 'member'
    });

    res.json({ message: 'Joined team successfully' });
  } catch (error) {
    console.error('Error joining team:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
