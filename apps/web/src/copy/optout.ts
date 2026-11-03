export const optoutCopy = {
  meta: {
    title: 'Opt out of the country index',
    description: 'Ask that a GitHub account never be included in the index of public developers used for country-wide search.',
  },
  eyebrow: 'Privacy',
  title: 'Opt out of the country index',
  intro: [
    'To make country-wide search possible, we slowly index public GitHub accounts by location: only the login, and the names, descriptions and topics of up to a few public repositories. People in the index have no page here and are never ranked.',
    'Enter a GitHub login to remove it. Whatever the index holds about it is deleted now, and it is never crawled again. Members of the site are not affected: their own settings decide what others see.',
  ],
  label: 'GitHub login',
  help: 'For example octo-learner, with or without the @.',
  submit: 'Opt out',
  done: 'Done. That login is out of the index and will not be crawled again.',
} as const;
