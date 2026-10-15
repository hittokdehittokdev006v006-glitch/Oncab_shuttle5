export const normalizeRoleName = (roleName?: unknown): string => {
  if (!roleName) return '';
  if (typeof roleName === 'string') return roleName.trim().toLowerCase();
  if (typeof roleName === 'object') {
    const obj = roleName as Record<string, any>;
    // 1. If it's a User object with a `role` property
    if (obj.role !== undefined && obj.role !== null) {
      if (typeof obj.role === 'string') return obj.role.trim().toLowerCase();
      if (typeof obj.role === 'object') {
        if (Number(obj.role.id) === 1) return 'admin';
        if (typeof obj.role.name === 'string') return obj.role.name.trim().toLowerCase();
      }
    }
    // 2. If it's a User object with role_name or role_id
    if (typeof obj.role_name === 'string') {
      return obj.role_name.trim().toLowerCase();
    }
    if (Number(obj.role_id) === 1) {
      return 'admin';
    }
    // 3. If it's a Role object directly (has display_name or lacks email/phone)
    if (typeof obj.name === 'string' && (obj.display_name !== undefined || (!obj.email && !obj.phone))) {
      if (Number(obj.id) === 1) return 'admin';
      return obj.name.trim().toLowerCase();
    }
  }
  return '';
};

export const hasRole = (
  userOrRole?: any,
  roleName?: string
): boolean => {
  if (!userOrRole) return false;

  if (roleName !== undefined && typeof roleName === 'string') {
    const target = normalizeRoleName(roleName);
    if (!target) return false;

    // Fast-path admin check
    if (target === 'admin') {
      if (
        Number(userOrRole?.role?.id) === 1 ||
        Number(userOrRole?.role_id) === 1 ||
        (Number(userOrRole?.id) === 1 && !userOrRole?.email)
      ) {
        return true;
      }
    }
    const actual = normalizeRoleName(userOrRole);
    return actual === target;
  }

  return false;
};
