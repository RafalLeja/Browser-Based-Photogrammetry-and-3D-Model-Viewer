export function Gallery() {
  const items = [
    { title: "Ancestral Mask", date: "Early 20th century", tags: ["CEREMONIAL OBJECT"] },
    { title: "Fossil Oyster", date: "Jurassic period", tags: ["NATURAL HISTORY", "PROCESSING"] },
    { title: "Terracotta Figures", date: "3rd century BCE", tags: ["SCULPTURE"] },
    { title: "Mourning Figure", date: "Late 19th century", tags: ["SCULPTURE"] },
  ];

  return (
    <>
      <section className="hero">
        <p className="subtitle">OPEN DIGITAL COLLECTION</p>
        <h1 className="main-title">Objects, preserved in three dimensions.</h1>
        <p className="description">
          Explore high-resolution models from the collection. Rotate, inspect, and discover each object from every angle.
        </p>
      </section>

      <section className="filters-section">
        <div className="search-box">
          <label>SEARCH COLLECTION</label>
          <div className="input-wrapper">
            <input type="text" placeholder="Search by title, type, or period" />
          </div>
        </div>

        <div className="sort-box">
          <label>SORT BY</label>
          <select>
            <option>Newest added</option>
          </select>
        </div>
      </section>

      <div className="grid-header">
        <span className="item-count">8 objects</span>
        <span className="view-mode">Interactive 3D records</span>
      </div>

      <section className="items-grid">
        {items.map((item, index) => (
          <div key={index} className="card">
            <div className="card-image-placeholder">
              <div className="tags">
                {item.tags.map(tag => (
                  <span key={tag} className="tag">{tag}</span>
                ))}
              </div>
            </div>
            <div className="card-info">
              <h3 className="card-title">{item.title}</h3>
              <p className="card-date">{item.date}</p>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}