  // States for Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');
  const [rosterSearch, setRosterSearch] = useState('');