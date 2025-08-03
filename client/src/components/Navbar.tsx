import React from 'react';

const Navbar: React.FC<{
  theme: string;
  setTheme: (theme: string) => void;
}> = ({ theme, setTheme }) => {
  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    if (newTheme === 'auto') {
      document.documentElement.setAttribute('data-bs-theme', 'auto');
    } else {
      document.documentElement.setAttribute('data-bs-theme', newTheme);
    }
  };

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-dark">
      <div className="container-fluid">
        <a className="navbar-brand" href="#">
          TeamChess
        </a>
        <div className="dropdown">
          <button
            className="btn btn-secondary dropdown-toggle"
            type="button"
            id="theme-dropdown"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <i className={`fas ${theme === 'light' ? 'fa-sun' : 'fa-moon'}`}></i>
          </button>
          <ul className="dropdown-menu" aria-labelledby="theme-dropdown">
            <li>
              <button
                className={`dropdown-item ${theme === 'light' ? 'active' : ''}`}
                onClick={() => handleThemeChange('light')}
              >
                <i className="fas fa-sun"></i> Light
              </button>
            </li>
            <li>
              <button
                className={`dropdown-item ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => handleThemeChange('dark')}
              >
                <i className="fas fa-moon"></i> Dark
              </button>
            </li>
            <li>
              <button
                className={`dropdown-item ${theme === 'auto' ? 'active' : ''}`}
                onClick={() => handleThemeChange('auto')}
              >
                <i className="fas fa-circle-half-stroke"></i> Auto
              </button>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
