const Organization = require('../models/Organization');
const User = require('../models/User');

exports.createOrg = async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ message: 'Organization name is required' });
    }

    // Create organization with current user as owner
    const org = await Organization.create({
      name,
      ownerId: req.user.id
    });

    res.status(201).json({
      message: 'Organization created successfully',
      organization: org
    });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.listMine = async (req, res) => {
  try {
    // Get all organizations the user belongs to
    const organizations = await Organization.forUser(req.user.id);
    
    res.json({
      organizations
    });
  } catch (error) {
    console.error('Error listing organizations:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.addMember = async (req, res) => {
  try {
    const { orgId } = req.params;
    const { userId, role } = req.body;
    
    if (!userId || !role) {
      return res.status(400).json({ message: 'User ID and role are required' });
    }

    // Check if user is admin or owner of the organization
    const isAdmin = await Organization.isAdmin(orgId, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only admins can add members' });
    }

    // Add member to organization
    await Organization.addMember({
      organizationId: orgId,
      userId,
      role
    });

    res.json({ message: 'Member added successfully' });
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
